import subprocess
from typing import List, Dict, Any, Optional
import json
from loguru import logger
import os

class KubectlResult:
    def __init__(self, success: bool, exit_code: int, stdout: str, stderr: str):
        self.success = success
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "exit_code": self.exit_code,
            "stdout": self.stdout,
            "stderr": self.stderr
        }

    def json_stdout(self) -> Optional[Any]:
        if not self.success or not self.stdout:
            return None
        try:
            return json.loads(self.stdout)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse kubectl stdout as JSON: {e}")
            return None

def execute_kubectl(args: List[str], timeout: float = 8.0, context: Optional[str] = None) -> KubectlResult:
    command = ["kubectl"]
    if context:
        command += ["--context", context]
    command += args
    
    from app.core.config import settings
    env = os.environ.copy()
    if settings.kubeconfig_path:
        env["KUBECONFIG"] = settings.kubeconfig_path
        
    logger.info(f"Executing command: {' '.join(command)}")
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env
        )
        success = result.returncode == 0
        if not success:
            logger.warning(f"Command failed with exit code {result.returncode}: stderr={result.stderr.strip()}")
        return KubectlResult(
            success=success,
            exit_code=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr
        )
    except FileNotFoundError:
        logger.error("kubectl CLI binary not found in system PATH.")
        return KubectlResult(
            success=False,
            exit_code=-1,
            stdout="",
            stderr="kubectl CLI binary not found in system PATH."
        )
    except subprocess.TimeoutExpired as e:
        logger.error(f"Command execution timed out after {timeout} seconds.")
        return KubectlResult(
            success=False,
            exit_code=-2,
            stdout="",
            stderr=f"Command execution timed out: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Unexpected error running kubectl: {str(e)}")
        return KubectlResult(
            success=False,
            exit_code=-3,
            stdout="",
            stderr=f"Unexpected error: {str(e)}"
        )

def get_contexts() -> Dict[str, Any]:
    logger.info("Retrieving Kubernetes contexts from kubeconfig...")
    result = execute_kubectl(["config", "view", "-o", "json"])
    if not result.success:
        logger.error(f"Failed to run config view: {result.stderr}")
        return {"contexts": [], "current_context": ""}
        
    data = result.json_stdout()
    if not data:
        logger.warning("No config view JSON output retrieved.")
        return {"contexts": [], "current_context": ""}
        
    contexts = []
    for ctx in data.get("contexts", []):
        contexts.append({
            "name": ctx.get("name"),
            "cluster": ctx.get("context", {}).get("cluster"),
            "user": ctx.get("context", {}).get("user")
        })
        
    return {
        "contexts": contexts,
        "current_context": data.get("current-context", "")
    }
