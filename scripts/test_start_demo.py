"""Tests for the Next.js offline launcher; no server or real data is touched."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("start_demo", Path(__file__).with_name("start-demo.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class DemoLauncherTests(unittest.TestCase):
    def test_demo_environment_overrides_cloud_and_normal_database(self):
        source = {"DATABASE_URL": "normal", "DEMO_DATABASE_URL": "remote-demo", "VERCEL": "1",
                  "GEMINI_API_KEY": "fake", "AUTH_DISABLED": "0", "PGLITE_DEMO_DIR": "normal-data"}
        env = launcher.demo_environment(Path("warehouse"), source)
        self.assertEqual(env["DEMO_MODE"], "1")
        self.assertEqual(env["MAGAZYNIER_DEMO_BUILD"], "1")
        self.assertEqual(env["LLM_MODE"], "offline")
        self.assertEqual(env["AUTH_DISABLED"], "1")
        self.assertEqual(env["PGLITE_DEMO_DIR"], str(Path("warehouse/data/pglite-demo").resolve()))
        for key in ("DATABASE_URL", "POSTGRES_URL", "DEMO_DATABASE_URL", "VERCEL",
                    "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "STT_API_KEY"):
            self.assertEqual(env[key], "")
        self.assertEqual(source["DATABASE_URL"], "normal")

    def test_missing_build_is_detected_before_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(launcher, "REPO", Path(directory)), patch.object(launcher.shutil, "which", return_value="npm"), patch.object(launcher.subprocess, "run") as run:
                self.assertEqual(launcher.main(["--reset"]), 1)
                run.assert_not_called()

    def test_busy_port_is_detected_before_build_or_reset(self):
        with patch.object(launcher.shutil, "which", return_value="npm"), patch.object(launcher, "port_available", return_value=False), patch.object(launcher.subprocess, "run") as run:
            self.assertEqual(launcher.main(["--build", "--reset"]), 1)
            run.assert_not_called()

    def test_failed_build_prevents_reset(self):
        with patch.object(launcher.shutil, "which", return_value="npm"), patch.object(launcher, "port_available", return_value=True), patch.object(launcher.subprocess, "run") as run:
            run.return_value.returncode = 1
            self.assertEqual(launcher.main(["--build", "--reset"]), 1)
            self.assertEqual(run.call_count, 1)

    def test_success_runs_reset_then_local_production_server(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            (repo / ".next-demo").mkdir()
            (repo / ".next-demo/BUILD_ID").write_text("test", encoding="utf-8")
            with patch.object(launcher, "REPO", repo), patch.object(launcher.shutil, "which", return_value="npm"), patch.object(launcher, "port_available", return_value=True), patch.object(launcher.subprocess, "run") as run, patch.object(launcher.subprocess, "Popen") as popen:
                run.return_value.returncode = 0
                popen.return_value.wait.return_value = 0
                popen.return_value.poll.return_value = 0
                self.assertEqual(launcher.main(["--reset", "--port", "3002"]), 0)
                self.assertIn("demo:reset", run.call_args.args[0])
                self.assertEqual(popen.call_args.args[0][-4:], ["--hostname", "127.0.0.1", "--port", "3002"])
                self.assertEqual(popen.call_args.kwargs["env"]["DEMO_MODE"], "1")


if __name__ == "__main__":
    unittest.main()
