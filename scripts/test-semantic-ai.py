"""API and engine contracts without installing Torch or downloading a model."""
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy" / "semantic-ai"))
from fastapi.testclient import TestClient
from app import create_app
from engine import ReviewEngine, validate_answer

PAIR = {"findingId": "f-1", "evidence": [{"page": 1, "text": "Pagamento em dez dias"}, {"page": 1, "text": "Pagamento em trinta dias"}]}
ANSWER = '{"items":[{"findingId":"f-1","reason":"obligation"}]}'


class SemanticTests(unittest.TestCase):
    def setUp(self):
        self.generations = 0
        self.loads = 0
        def factory(model, revision):
            self.loads += 1
            def generate(messages):
                self.generations += 1
                self.assertIn("DADOS NAO CONFIAVEIS", messages[0]["content"])
                self.assertIn("Pagamento em dez dias", messages[1]["content"])
                return ANSWER
            return generate
        self.engine = ReviewEngine("public/model", "a" * 40, factory)
        self.client = TestClient(create_app(self.engine))
        self.environment = patch.dict(os.environ, {"REVIEW_API_KEY": "synthetic-key"})
        self.environment.start()
        self.headers = {"Authorization": "Bearer synthetic-key"}
        self.payload = {"model": "public/model", "pairs": [PAIR]}

    def tearDown(self):
        self.client.close()
        self.environment.stop()

    def test_authenticated_review_reuses_model_and_preserves_ids(self):
        for _ in range(2):
            response = self.client.post("/v1/review", json=self.payload, headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.json()["content"]), json.loads(ANSWER))
            self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual((self.loads, self.generations), (1, 2))

    def test_missing_configuration_and_auth_do_not_load_model(self):
        self.assertEqual(self.client.post("/v1/review", json=self.payload).status_code, 401)
        with patch.dict(os.environ, {"REVIEW_API_KEY": ""}):
            self.assertEqual(self.client.post("/v1/review", json=self.payload, headers=self.headers).status_code, 503)
        self.assertEqual(self.loads, 0)

    def test_limits_duplicates_and_invalid_inputs_do_not_echo_text(self):
        self.assertEqual(self.client.post("/v1/review", content=b"x" * 66000, headers=self.headers).status_code, 413)
        response = self.client.post("/v1/review", json={**self.payload, "private": "DO NOT ECHO"}, headers=self.headers)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("DO NOT ECHO", response.text)
        self.assertEqual(self.client.post("/v1/review", json={**self.payload, "pairs": [PAIR, PAIR]}, headers=self.headers).status_code, 422)
        self.assertEqual(self.loads, 0)

    def test_unknown_model_busy_and_unpinned_revision_fail_safely(self):
        self.assertEqual(self.client.post("/v1/review", json={**self.payload, "model": "other"}, headers=self.headers).status_code, 422)
        self.engine.lock.acquire()
        try:
            self.assertEqual(self.client.post("/v1/review", json=self.payload, headers=self.headers).status_code, 429)
        finally:
            self.engine.lock.release()
        self.engine.revision = "main"
        self.assertEqual(self.client.post("/v1/review", json=self.payload, headers=self.headers).status_code, 503)
        self.assertEqual(self.loads, 0)

    def test_fabricated_incomplete_and_extra_output_is_rejected(self):
        for raw in [ANSWER[:-1], '{"items":[{"findingId":"fake","reason":"obligation"}]}', '{"items":[],"evidence":"invented"}', '{"items":[{"findingId":"f-1","reason":"fraud"}]}']:
            with self.assertRaises((ValueError, TypeError)):
                validate_answer(raw, {"f-1"})


if __name__ == "__main__":
    unittest.main()
