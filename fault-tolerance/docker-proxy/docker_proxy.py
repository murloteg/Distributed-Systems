from flask import Flask, request, jsonify
import docker
import json
import os

app = Flask(__name__)
client = docker.from_env()

CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'containers.json')

@app.route('/api/v1/stop-container', methods=['POST'])
def stop_container():
    data = request.json
    container_name = data.get('name')

    if not container_name:
        return jsonify({'error': 'Container name is required'}), 400

    try:
        container = client.containers.get(container_name)
        container.stop()
        return jsonify({'status': 'stopped', 'container': container_name}), 200
    except docker.errors.NotFound:
        return jsonify({'error': f'Container {container_name} not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/status-check', methods=['GET'])
def status_check():
    try:
        with open(CONFIG_PATH) as f:
            container_names = json.load(f)
    except Exception as e:
        return jsonify({'error': f'Failed to load container list: {e}'}), 500

    result = {}

    for name in container_names:
        try:
            container = client.containers.get(name)
            if container.status == "running":
                result[name] = "running"
            else:
                result[name] = "stopped"
        except docker.errors.NotFound:
            result[name] = "stopped"
        except Exception as e:
            result[name] = f"error: {str(e)}"

    return jsonify(result), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=17871)
