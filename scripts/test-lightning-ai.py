"""Validate the Lightning bootstrap without installing packages or loading model weights."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / "deploy" / "lightning-ai" / "manage.py"
spec = importlib.util.spec_from_file_location("lightning_manage", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LightningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pdfmaster-lightning-tests-")
        self.root = Path(self.temp.name)
        self.patches = [patch.object(module, "ROOT", self.root), patch.object(module, "RUNTIME", self.root / ".lightning-ai"), patch.dict(os.environ, {"REVIEW_API_KEY": ""})]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_secret_is_private_and_reused_without_printing(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            first = module.secret(create=True)
            second = module.secret(create=True)
        self.assertEqual(first, second)
        self.assertGreaterEqual(len(first), 32)
        self.assertNotIn(first, output.getvalue())
        if os.name != "nt":
            self.assertEqual((self.root / ".lightning-ai" / "review.key").stat().st_mode & 0o077, 0)
        with patch.dict(os.environ, {"REVIEW_API_KEY": "short"}):
            with self.assertRaises(ValueError):
                module.secret()

    def test_preset_is_immutable_and_remote_http_or_credential_urls_are_rejected(self):
        config = module.settings()
        self.assertEqual(config["model"], "Qwen/Qwen2.5-0.5B-Instruct")
        self.assertRegex(config["revision"], r"^[a-f0-9]{40}$")
        for url in ["http://outside.example", "https://user:secret@outside.example", "https://outside.example?key=secret", "https://outside.example#secret", "https://outside.example:bad"]:
            with self.assertRaises(ValueError):
                module.base_url(url)
        self.assertEqual(module.base_url("https://api.example/prefix/"), "https://api.example/prefix")
        self.assertEqual(module.base_url("http://127.0.0.1:8080"), "http://127.0.0.1:8080")

    def test_setup_only_installs_cpu_and_does_not_download_models(self):
        calls = []
        class Builder:
            def create(self, path):
                (path / "bin").mkdir(parents=True)
                (path / "bin" / "python").touch()
        with patch.object(module.sys, "platform", "linux"), patch.object(module.venv, "EnvBuilder", return_value=Builder()), patch.object(module.subprocess, "run", side_effect=lambda args, **kwargs: calls.append(args)), contextlib.redirect_stdout(io.StringIO()):
            module.setup()
        self.assertEqual(len(calls), 2)
        self.assertIn("https://download.pytorch.org/whl/cpu", calls[0])
        self.assertIn("torch==2.14.1", calls[0])
        self.assertFalse((self.root / ".lightning-ai" / "models").exists())
        self.assertNotIn(module.secret(), repr(calls))

    def opener(self, *, ready=True, protected=True, content=None):
        model = module.settings()["model"]
        class Opener:
            def open(self, request, timeout):
                if request.full_url.endswith("/health"):
                    result = {"status": "ok", "modelLoaded": ready}
                elif not request.get_header("Authorization") and protected:
                    raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)
                else:
                    result = {"model": model, "content": content if content is not None else '{"items":[{"findingId":"test-1","reason":"obligation"}]}'}
                return io.BytesIO(json.dumps(result).encode())
        return Opener()

    def test_probe_requires_real_model_readiness_authentication_and_valid_references(self):
        module.secret(create=True)
        self.assertEqual(module.probe("https://api.example", self.opener()), "https://api.example")
        with self.assertRaises(RuntimeError):
            module.probe("https://api.example", self.opener(ready=False))
        with self.assertRaises(RuntimeError):
            module.probe("https://api.example", self.opener(protected=False))
        with self.assertRaises(ValueError):
            module.probe("https://api.example", self.opener(content='{"items":[{"findingId":"invented","reason":"wording"}]}'))
        with self.assertRaises(RuntimeError):
            module.probe("https://api.example", self.opener(content='{"items":[]}'))

    def test_export_is_private_and_only_after_successful_probe(self):
        key = module.secret(create=True)
        with patch.object(module, "probe", return_value="https://api.example"), contextlib.redirect_stdout(io.StringIO()) as output:
            module.render_config("https://api.example")
        target = self.root / ".lightning-ai" / "render.env"
        self.assertIn("DIVERGENCE_AI_PROVIDER=transformers", target.read_text())
        self.assertIn(key, target.read_text())
        self.assertNotIn(key, output.getvalue())
        if os.name != "nt":
            self.assertEqual(target.stat().st_mode & 0o077, 0)
        with patch.object(module, "probe", side_effect=RuntimeError("not ready")):
            with self.assertRaises(RuntimeError):
                module.render_config("https://api.example")

    def test_redirects_and_windows_setup_are_refused(self):
        with self.assertRaises(ValueError):
            module.NoRedirect().redirect_request(None, None, 302, "", {}, "https://outside.example")
        with patch.object(module.sys, "platform", "win32"):
            with self.assertRaises(RuntimeError):
                module.setup()


if __name__ == "__main__":
    unittest.main()
