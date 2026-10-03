"""Update only the existing gateway's inbox normalizer, with backup and rollback.
Requires SSH_PASSWORD in the environment and a host already in known_hosts.
"""
import os
import pathlib
import shlex
import sys
import time
import paramiko

host, container = sys.argv[1:3]
client = paramiko.SSHClient()
client.load_system_host_keys()
client.connect(host, username=os.environ.get('SSH_USER', 'codex'), password=os.environ['SSH_PASSWORD'], timeout=15)

def run(command):
    _, out, err = client.exec_command(command, timeout=120)
    result = out.read().decode()
    error = err.read().decode()
    if out.channel.recv_exit_status():
        raise RuntimeError(error or result)
    return result.strip()

name = shlex.quote(container)
stamp = time.strftime('%Y%m%d-%H%M%S')
folder = '/tmp/whatsapp-reply-' + stamp
original = '/app/dist/src/inbox-content.js'
try:
    run(f'mkdir -p {folder}')
    run(f'docker cp {name}:{original} {folder}/original.js')
    image = run(f"docker inspect --format '{{{{.Config.Image}}}}' {name}")
    backup = 'whatsapp-gateway-backup:' + stamp
    run(f'docker commit {name} {backup}')
    with client.open_sftp() as sftp:
        sftp.put(str(pathlib.Path(__file__).with_name('inbox-content.mjs')), folder + '/updated.js')
    try:
        run(f'docker cp {folder}/updated.js {name}:{original}')
        run(f'docker exec {name} node --check {original}')
        run(f'docker restart {name}')
        for attempt in range(20):
            try:
                run(f'''docker exec {name} node -e 'fetch("http://127.0.0.1:3334/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' ''')
                break
            except RuntimeError:
                if attempt == 19:
                    raise
                time.sleep(2)
        run(f'docker commit {name} {shlex.quote(image)}')
        print(f'Gateway healthy; backup image: {backup}; original module: {folder}/original.js')
    except Exception:
        run(f'docker cp {folder}/original.js {name}:{original}')
        run(f'docker restart {name}')
        raise
finally:
    client.close()
