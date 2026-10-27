"""Deploy only after configuring a shared BACKEND_TOKEN and persistent volume."""
import modal

image = (modal.Image.debian_slim(python_version='3.12')
         .pip_install_from_requirements('backend/requirements.txt')
         .add_local_python_source('backend'))
app = modal.App('signal-war')
volume = modal.Volume.from_name('signal-war-data', create_if_missing=True)


@app.function(image=image, secrets=[modal.Secret.from_name('signal-war')],
              volumes={'/data': volume}, min_containers=0, max_containers=1, timeout=300)
@modal.asgi_app()
def api():
    import os
    if not os.getenv('BACKEND_TOKEN'):
        raise RuntimeError('Set BACKEND_TOKEN before exposing paid model endpoints')
    os.environ['DATA_DIR'] = '/data'
    from backend.main import app as web_app, store
    store.on_save = volume.commit
    return web_app
