from typing import Dict, Any, List, Optional
from loguru import logger
from app.kubernetes.executor import execute_kubectl

def collect_logs_for_pods(problematic_pods: List[Dict[str, Any]], tail_lines: int = 50, context: Optional[str] = None) -> Dict[str, Any]:
    logger.info(f"Starting Logs collection for {len(problematic_pods)} pods...")
    logs_data = {}
    
    for pod in problematic_pods:
        pod_name = pod.get("name")
        namespace = pod.get("namespace")
        if not pod_name or not namespace:
            continue
            
        key = f"{namespace}/{pod_name}"
        logger.info(f"Collecting logs for pod {key}...")
        
        result = execute_kubectl(["logs", pod_name, "-n", namespace, f"--tail={tail_lines}"], context=context)
        
        if result.success:
            log_text = result.stdout
            
            error_indicators = ["exception", "connection failure", "missing env", "error", "fail", "fatal", "warn"]
            found_errors = []
            
            for line in log_text.splitlines():
                if any(ind in line.lower() for ind in error_indicators):
                    found_errors.append(line.strip())
                    
            logs_data[key] = {
                "success": True,
                "lines_collected": len(log_text.splitlines()),
                "logs_preview": log_text,
                "detected_issues": found_errors[:10]
            }
        else:
            logger.info(f"Retrying with --previous for pod {key}...")
            prev_result = execute_kubectl(["logs", pod_name, "-n", namespace, "--previous", f"--tail={tail_lines}"], context=context)
            if prev_result.success:
                log_text = prev_result.stdout
                error_indicators = ["exception", "connection failure", "missing env", "error", "fail", "fatal", "warn"]
                found_errors = []
                for line in log_text.splitlines():
                    if any(ind in line.lower() for ind in error_indicators):
                        found_errors.append(line.strip())
                logs_data[key] = {
                    "success": True,
                    "previous_container_logs": True,
                    "lines_collected": len(log_text.splitlines()),
                    "logs_preview": log_text,
                    "detected_issues": found_errors[:10]
                }
            else:
                logger.warning(f"Could not retrieve logs for pod {key}: {result.stderr.strip()}")
                logs_data[key] = {
                    "success": False,
                    "error": f"Failed to retrieve logs: {result.stderr.strip()}"
                }
                
    logger.info("Logs collection completed.")
    return logs_data
