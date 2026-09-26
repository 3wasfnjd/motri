import msgpack from 'msgpack-lite'
import { v4 as uuidv4 } from 'uuid'
import { Events } from './Events.js'
import { Game } from './Game.js'

export class Server
{
    constructor()
    {
        this.game = Game.getInstance()

        // Unique session ID
        this.uuid = localStorage.getItem('uuid')
        if(!this.uuid)
        {
            this.uuid = uuidv4()
            localStorage.setItem('uuid', this.uuid)
        }

        this.connected = false
        this.connecting = false
        this.initData = null
        this.events = new Events()
        this.sessionUuid = uuidv4()
        this.reconnectInterval = null
        this.room = new URLSearchParams(window.location.search).get('room') || import.meta.env.VITE_MULTIPLAYER_ROOM || 'public'
        document.documentElement.classList.add('is-server-offline')
    }

    start()
    {
        if(!import.meta.env.VITE_SERVER_URL || this.reconnectInterval)
            return

        this.connect()

        this.reconnectInterval = setInterval(() =>
        {
            if(!this.connected && !this.connecting)
                this.connect()
        }, 2000)
    }

    getSocketUrl()
    {
        const base = String(import.meta.env.VITE_SERVER_URL || '').replace(/\/+$/, '')
        if(!base)
            return null

        if(base.includes('{room}'))
            return base.replace('{room}', encodeURIComponent(this.room))

        return `${base}/room/${encodeURIComponent(this.room)}`
    }

    connect()
    {
        const socketUrl = this.getSocketUrl()
        if(!socketUrl || this.connecting || this.connected)
            return

        this.connecting = true

        let socket
        try
        {
            socket = new WebSocket(socketUrl)
        }
        catch(error)
        {
            this.connecting = false
            console.warn('Server > Invalid WebSocket URL', socketUrl, error)
            return
        }

        this.socket = socket
        socket.binaryType = 'arraybuffer'

        socket.addEventListener('open', () =>
        {
            if(this.socket !== socket)
                return

            this.connecting = false
            this.connected = true
            document.documentElement.classList.remove('is-server-offline')
            document.documentElement.classList.add('is-server-online')
            this.events.trigger('connected')

            if(this.game.ticker.elapsed > 10)
            {
                const html = /* html */`
                    <div class="top">
                        <div class="title">تم الاتصال بالغرفة ${this.room}</div>
                    </div>
                `

                this.game.notifications.show(
                    html,
                    'server-connected',
                    5,
                    null,
                    'server-connected'
                )
            }
        })

        socket.addEventListener('message', (message) =>
        {
            if(this.socket === socket)
                this.onReceive(message)
        })

        socket.addEventListener('close', () =>
        {
            if(this.socket !== socket)
                return

            const wasConnected = this.connected
            this.connecting = false
            this.connected = false
            document.documentElement.classList.add('is-server-offline')
            document.documentElement.classList.remove('is-server-online')

            if(wasConnected && this.game.ticker.elapsed > 10)
            {
                const html = /* html */`
                    <div class="top">
                        <div class="title">انقطع الاتصال باللعب الجماعي</div>
                    </div>
                `

                this.game.notifications.show(
                    html,
                    'server-disconnected',
                    5,
                    null,
                    'server-disconnected'
                )
            }

            this.events.trigger('disconnected')
        })

        socket.addEventListener('error', () =>
        {
            if(this.socket === socket)
                this.connecting = false
        })
    }

    onReceive(message)
    {
        let data
        try
        {
            data = this.decode(message.data)
        }
        catch(error)
        {
            console.warn('Server > Invalid message', error)
            return
        }

        if(this.initData === null)
            this.initData = data

        this.events.trigger('message', [ data ])
    }

    send(message)
    {
        if(!this.connected)
            return false

        this.socket.send(this.encode({
            uuid: this.sessionUuid,
            deviceUuid: this.uuid,
            room: this.room,
            ...message
        }))
    }

    decode(data)
    {
        if(typeof data === 'string')
            return JSON.parse(data)

        return msgpack.decode(new Uint8Array(data))
    }

    encode(data)
    {
        return JSON.stringify(data)
    }
}