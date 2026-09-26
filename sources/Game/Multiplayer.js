import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

const SEND_INTERVAL = 1 / 10
const POSITION_EASING = 12
const ROTATION_EASING = 14
const TELEPORT_DISTANCE = 18

export class Multiplayer
{
    constructor()
    {
        this.game = Game.getInstance()
        this.enabled = !!import.meta.env.VITE_SERVER_URL
        this.remotePlayers = new Map()
        this.sendAccumulator = 0
        this.sequence = 0

        this.game.server.events.on('connected', () => this.onConnected())
        this.game.server.events.on('message', (message) => this.onMessage(message))
        this.game.server.events.on('disconnected', () => this.clearRemotePlayers())

        this.game.ticker.events.on('tick', () => this.update(), 9)
    }

    onConnected()
    {
        const storedName = localStorage.getItem('multiplayerName')
        const shortId = this.game.server.sessionUuid.slice(0, 4).toUpperCase()

        this.game.server.send({
            type: 'hello',
            name: storedName || `MOTRI-${shortId}`
        })
    }

    onMessage(message)
    {
        if(!message || typeof message !== 'object')
            return

        if(message.type === 'welcome')
        {
            if(Array.isArray(message.players))
            {
                for(const player of message.players)
                {
                    if(player?.uuid && player.state)
                        this.applyRemoteState(player.uuid, player.name, player.state)
                }
            }
            return
        }

        if(message.type === 'state' && message.uuid && message.uuid !== this.game.server.sessionUuid)
        {
            this.applyRemoteState(message.uuid, message.name, message.state)
            return
        }

        if(message.type === 'leave' && message.uuid)
        {
            this.removeRemotePlayer(message.uuid)
        }
    }

    applyRemoteState(uuid, name, state)
    {
        if(!state || !Array.isArray(state.p) || !Array.isArray(state.q))
            return

        let remote = this.remotePlayers.get(uuid)
        if(!remote)
            remote = this.createRemotePlayer(uuid, name)

        remote.name = name || remote.name
        remote.targetPosition.fromArray(state.p)
        remote.targetQuaternion.fromArray(state.q)
        remote.velocity.fromArray(Array.isArray(state.v) ? state.v : [ 0, 0, 0 ])
        remote.steering = Number.isFinite(state.s) ? state.s : 0
        remote.accelerating = Number.isFinite(state.a) ? state.a : 0
        remote.braking = !!state.b
        remote.boosting = !!state.boost

        if(!remote.initialized || remote.model.position.distanceTo(remote.targetPosition) > TELEPORT_DISTANCE)
        {
            remote.model.position.copy(remote.targetPosition)
            remote.model.quaternion.copy(remote.targetQuaternion)
            remote.initialized = true
        }
    }

    createRemotePlayer(uuid, name)
    {
        const source = this.game.world.visualVehicle?.parts?.chassis
        if(!source)
            return null

        const model = source.clone(true)
        model.name = `RemoteVehicle_${uuid}`
        model.traverse((child) =>
        {
            child.userData = {}
            if(child.isMesh)
            {
                child.castShadow = true
                child.receiveShadow = true
            }
        })

        const frontWheels = []
        const wheelCylinders = []
        for(const child of model.children)
        {
            if(/^wheelContainer/i.test(child.name) && child.position.x > 0)
                frontWheels.push({ object: child, baseRotationY: child.rotation.y })
        }
        model.traverse((child) =>
        {
            if(/^wheelCylinder/i.test(child.name))
                wheelCylinders.push(child)
        })

        this.game.scene.add(model)

        const remote = {
            uuid,
            name: name || 'MOTRI',
            model,
            targetPosition: model.position.clone(),
            targetQuaternion: model.quaternion.clone(),
            velocity: new THREE.Vector3(),
            steering: 0,
            accelerating: 0,
            braking: false,
            boosting: false,
            frontWheels,
            wheelCylinders,
            initialized: false
        }

        this.remotePlayers.set(uuid, remote)
        return remote
    }

    removeRemotePlayer(uuid)
    {
        const remote = this.remotePlayers.get(uuid)
        if(!remote)
            return

        remote.model.removeFromParent()
        this.remotePlayers.delete(uuid)
    }

    clearRemotePlayers()
    {
        for(const uuid of [ ...this.remotePlayers.keys() ])
            this.removeRemotePlayer(uuid)
    }

    buildLocalState()
    {
        const vehicle = this.game.physicalVehicle
        const player = this.game.player

        return {
            p: vehicle.position.toArray().map(value => Number(value.toFixed(3))),
            q: vehicle.quaternion.toArray().map(value => Number(value.toFixed(4))),
            v: vehicle.velocity.toArray().map(value => Number(value.toFixed(3))),
            s: Number(player.steering.toFixed(3)),
            a: Number(player.accelerating.toFixed(3)),
            b: player.braking > 0 ? 1 : 0,
            boost: player.boosting > 0 ? 1 : 0,
            seq: ++this.sequence
        }
    }

    update()
    {
        if(!this.enabled)
            return

        const dt = Math.max(0, Math.min(this.game.ticker.delta, 0.1))

        if(this.game.server.connected)
        {
            this.sendAccumulator += dt
            if(this.sendAccumulator >= SEND_INTERVAL)
            {
                this.sendAccumulator %= SEND_INTERVAL
                this.game.server.send({
                    type: 'state',
                    state: this.buildLocalState()
                })
            }
        }

        const positionAlpha = 1 - Math.exp(-POSITION_EASING * dt)
        const rotationAlpha = 1 - Math.exp(-ROTATION_EASING * dt)

        for(const remote of this.remotePlayers.values())
        {
            if(!remote.initialized)
                continue

            remote.model.position.lerp(remote.targetPosition, positionAlpha)
            remote.model.quaternion.slerp(remote.targetQuaternion, rotationAlpha)

            for(const frontWheel of remote.frontWheels)
            {
                const sideBase = Math.abs(frontWheel.baseRotationY) > Math.PI * 0.5 ? Math.PI : 0
                frontWheel.object.rotation.y = sideBase + remote.steering * this.game.physicalVehicle.steeringAmplitude
            }

            const speed = remote.velocity.length()
            const wheelRotation = speed * dt / this.game.physicalVehicle.wheels.settings.radius
            for(const wheel of remote.wheelCylinders)
                wheel.rotation.z += wheelRotation
        }
    }
}
