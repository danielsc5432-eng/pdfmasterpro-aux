"""Run ONLY in the chosen free CPU Studio; never provisions or upgrades resources."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import venv

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / ".lightning-ai"
SERVICE = ROOT / "deploy" / "semantic-ai"
PRESET = Path(__file__).with_name("model.json")


def settings():
    config = json.loads(PRESET.read_text(encoding="utf-8"))
    if set(config) != {"model", "revision"} or not isinstance(config["model"], str) or not re.fullmatch(r"[a-f0-9]{40}", config["revision"]):
        raise ValueError("Invalid model preset")
    return config


def runtime_path():
    if RUNTIME.resolve().parent != ROOT.resolve():
        raise ValueError("Runtime directory must remain inside the repository")
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    return RUNTIME


def secret(create=False):
    value = os.getenv("REVIEW_API_KEY", "")
    if not value:
        target = runtime_path() / "review.key"
        if target.is_symlink():
            raise ValueError("Secret must not be a symlink")
        if create and not target.exists():
            with target.open("x", encoding="ascii") as handle:
                os.chmod(target, 0o600)
                handle.write(secrets.token_urlsafe(32))
        if not target.exists():
            raise RuntimeError("Run setup first, or configure REVIEW_API_KEY as a private secret")
        value = target.read_text(encoding="ascii").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,200}", value):
        raise ValueError("REVIEW_API_KEY must contain 32-200 URL-safe characters")
    return value


def environment():
    config = settings()
    return {**os.environ, "MODEL_ID": config["model"], "MODEL_REVISION": config["revision"],
            "REVIEW_API_KEY": secret(), "HF_HOME": str(runtime_path() / "models"),
            "CUDA_VISIBLE_DEVICES": "", "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1",
            "TOKENIZERS_PARALLELISM": "false", "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
            "PYTHONDONTWRITEBYTECODE": "1"}


def setup():
    if sys.platform != "linux" or sys.version_info < (3, 11):
        raise RuntimeError("Run setup inside the Lightning CPU Studio with Linux and Python 3.11+")
    directory = runtime_path() / "venv"
    if not (directory / "bin" / "python").exists():
        venv.EnvBuilder(with_pip=True).create(directory)
    python = str(directory / "bin" / "python")
    secret(create=True)
    subprocess.run([python, "-m", "pip", "install", "--disable-pip-version-check", "--index-url",
                    "https://download.pytorch.org/whl/cpu", "torch==2.14.1"], check=True)
    subprocess.run([python, "-m", "pip", "install", "--disable-pip-version-check", "-r",
                    str(SERVICE / "requirements.txt")], check=True)
    print("CPU dependencies prepared. Secret kept private; no model downloaded yet.")


def start():
    python = runtime_path() / "venv" / "bin" / "python"
    if not python.exists():
        raise RuntimeError("Run setup inside the free CPU Studio first")
    env = environment()
    if Path(sys.prefix).resolve() != python.parent.parent.resolve():
        os.execve(str(python), [str(python), str(Path(__file__).resolve()), "start"], env)
    os.environ.update(env)
    sys.path.insert(0, str(SERVICE))
    from engine import ReviewEngine
    from app import create_app
    import uvicorn
    import torch
    torch.set_num_threads(2)
    backend = ReviewEngine()
    print("Loading the pinned CPU model. Wait for readiness; no user documents are used.", flush=True)
    backend.generator = backend.factory(backend.model, backend.revision)
    print("Model loaded. Starting protected API on port 8080.", flush=True)
    uvicorn.run(create_app(backend), host="0.0.0.0", port=8080, workers=1, access_log=False)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise ValueError("Redirect refused; use the direct API URL")


def base_url(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError("Invalid API port")
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or (parsed.scheme != "https" and not (loopback and parsed.scheme == "http")):
        raise ValueError("Use the direct HTTPS URL, without credentials or query parameters")
    return value.rstrip("/")


def probe(url, opener=None):
    url = base_url(url)
    client = opener if opener is not None else urllib.request.build_opener(NoRedirect())
    config = settings()
    body = {"model": config["model"], "pairs": [{"findingId": "test-1", "evidence": [
        {"page": 1, "text": "Clausula 1: O pagamento deve ocorrer em 10 dias."},
        {"page": 1, "text": "Clausula 1: O pagamento deve ocorrer em 30 dias."}]}]}

    def call(path, payload=None, authenticated=False):
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Authorization"] = "Bearer " + secret()
        request = urllib.request.Request(url + path, headers=headers,
                    data=json.dumps(payload).encode() if payload is not None else None)
        with client.open(request, timeout=20) as response:
            data = response.read(128 * 1024 + 1)
            if len(data) > 128 * 1024:
                raise ValueError("Response too large")
            return json.loads(data)

    health = call("/health")
    if health.get("status") != "ok" or health.get("modelLoaded") is not True:
        raise RuntimeError("Model not ready; wait for startup before connecting the site")
    try:
        call("/v1/review", body)
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise RuntimeError("Unexpected unauthenticated response") from None
    else:
        raise RuntimeError("API is not protected; do not connect it to the site")
    result = call("/v1/review", body, True)
    if result.get("model") != config["model"]:
        raise ValueError("Unexpected model")
    sys.path.insert(0, str(SERVICE))
    from engine import validate_answer
    checked = json.loads(validate_answer(result.get("content", ""), {"test-1"}))
    if len(checked["items"]) != 1:
        raise RuntimeError("The model did not flag the synthetic difference; review quality before enabling")
    return url


def render_config(url):
    url = probe(url)
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("The Render connection requires a public HTTPS URL")
    config = settings()
    target = runtime_path() / "render.env"
    if target.is_symlink():
        raise ValueError("Configuration must not be a symlink")
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.chmod(target, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write("DIVERGENCE_AI_PROVIDER=transformers\n")
        handle.write("DIVERGENCE_TRANSFORMERS_URL=" + url + "\n")
        handle.write("DIVERGENCE_TRANSFORMERS_MODEL=" + config["model"] + "\n")
        handle.write("DIVERGENCE_TRANSFORMERS_KEY=" + secret() + "\n")
    print("Connection validated. Private configuration saved in .lightning-ai/render.env; never paste it in chat.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["setup", "start", "check", "render-config"])
    parser.add_argument("url", nargs="?", default="http://127.0.0.1:8080")
    args = parser.parse_args()
    if args.action == "setup":
        setup()
    elif args.action == "start":
        start()
    elif args.action == "check":
        probe(args.url)
        print("PASS: model ready, authentication enforced, synthetic review validated within the HTTP deadline.")
    else:
        render_config(args.url)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, urllib.error.URLError, subprocess.CalledProcessError) as error:
        # Never print raw remote responses or headers containing credentials/documents.
        print("Lightning setup/check failed: " + (str(error) if isinstance(error, (ValueError, RuntimeError)) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
