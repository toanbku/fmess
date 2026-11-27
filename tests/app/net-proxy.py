#!/usr/bin/env python3
"""A local HTTPS proxy that can cut the network, for fMess's live checks.

The debug app sends its page's traffic through it (FMESS_PROXY, see
live-check.sh). It only tunnels (CONNECT): it never sees inside TLS.

    net-proxy.py <port> <control port> <log.jsonl>

The control port takes GET /pass, /blackhole, /refuse, /reset and /stats:
  pass       tunnels work (new ones too)
  blackhole  the network dies silently, as when a computer sleeps or its
             Wi-Fi drops: open tunnels pass nothing either way and never
             close, new ones get no answer. Tunnels opened before stay dead
             after /pass, as a connection whose route is gone does.
  refuse     offline: open tunnels close, new ones are refused at once
  reset      every open tunnel closes (the network stays up)
  stats      every tunnel: host, when it opened and closed, bytes and last
             activity each way
"""
import asyncio
import json
import sys
import time

PORT, CONTROL, LOG = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
mode = 'pass'
changed = asyncio.Event()
tunnels = []


def log(event, **fields):
    with open(LOG, 'a') as out:
        out.write(json.dumps({'t': time.time(), 'event': event, **fields}) + '\n')


class Tunnel:
    def __init__(self, host):
        self.id = len(tunnels)
        self.host = host
        self.opened = time.time()
        self.closed = None
        self.up = self.down = 0
        self.last_up = self.last_down = None
        self.dead = False  # blackholed: passes nothing, for good
        self.left = None  # when the app closed its end
        self.writers = []

    def close(self):
        if self.closed is None:
            self.closed = time.time()
            log('close', id=self.id, host=self.host)
        for writer in self.writers:
            try:
                writer.transport.abort()
            except Exception:
                pass

    def stats(self):
        return {k: getattr(self, k) for k in ('id', 'host', 'opened', 'closed', 'left', 'up', 'down', 'last_up', 'last_down', 'dead')}


async def pipe(tunnel, reader, writer, up):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            if tunnel.dead:
                continue  # dropped, as on a dead route
            writer.write(data)
            await writer.drain()
            now = time.time()
            if up:
                tunnel.up += len(data)
                tunnel.last_up = now
            else:
                tunnel.down += len(data)
                tunnel.last_down = now
    except Exception:
        pass
    if up and tunnel.left is None:
        tunnel.left = time.time()
        log('app-closed', id=tunnel.id, host=tunnel.host, dead=tunnel.dead)
    if not tunnel.dead or up:
        tunnel.close()


async def client(reader, writer):
    try:
        request = await reader.readuntil(b'\r\n\r\n')
    except Exception:
        writer.close()
        return
    line = request.split(b'\r\n', 1)[0].decode(errors='replace').split()
    if len(line) < 2 or line[0] != 'CONNECT':
        writer.write(b'HTTP/1.1 405 Only CONNECT\r\n\r\n')
        writer.close()
        return
    target = line[1]
    host, _, port = target.rpartition(':')
    # No answer while the network is dead; refused while offline.
    while mode == 'blackhole':
        changed.clear()
        await changed.wait()
    if mode == 'refuse':
        log('refused', host=host)
        writer.write(b'HTTP/1.1 502 Offline\r\n\r\n')
        writer.close()
        return
    try:
        up_reader, up_writer = await asyncio.wait_for(asyncio.open_connection(host.strip('[]'), int(port)), 15)
    except Exception as error:
        log('connect-failed', host=host, error=str(error))
        writer.write(b'HTTP/1.1 502 Bad Gateway\r\n\r\n')
        writer.close()
        return
    tunnel = Tunnel(target)
    tunnel.writers = [writer, up_writer]
    tunnels.append(tunnel)
    log('open', id=tunnel.id, host=target)
    writer.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
    await writer.drain()
    await asyncio.gather(pipe(tunnel, reader, up_writer, True), pipe(tunnel, up_reader, writer, False))


def set_mode(new):
    global mode
    if new == 'reset':
        for tunnel in tunnels:
            if tunnel.closed is None and not tunnel.dead:
                tunnel.close()
        log('reset')
        return
    mode = new
    if new == 'blackhole':
        for tunnel in tunnels:
            if tunnel.closed is None:
                tunnel.dead = True
    if new == 'refuse':
        for tunnel in tunnels:
            if tunnel.closed is None:
                tunnel.close()
    changed.set()
    log('mode', mode=new)


async def control(reader, writer):
    try:
        request = await reader.readuntil(b'\r\n\r\n')
        path = request.split(b' ', 2)[1].decode()
        if path == '/stats':
            body = json.dumps({'mode': mode, 'now': time.time(), 'tunnels': [t.stats() for t in tunnels]})
        elif path.strip('/') in ('pass', 'blackhole', 'refuse', 'reset'):
            set_mode(path.strip('/'))
            body = json.dumps({'mode': mode})
        else:
            body = json.dumps({'error': 'unknown'})
        data = body.encode()
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n' % len(data) + data)
        await writer.drain()
    finally:
        writer.close()


async def main():
    log('start', port=PORT)
    await asyncio.start_server(client, '127.0.0.1', PORT)
    await asyncio.start_server(control, '127.0.0.1', CONTROL)
    await asyncio.Event().wait()


asyncio.run(main())
