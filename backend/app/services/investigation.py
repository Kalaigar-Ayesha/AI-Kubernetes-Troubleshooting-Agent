from typing import Dict, Any
from loguru import logger

from app.kubernetes.pod_inspector import inspect_pods
from app.kubernetes.logs_collector import collect_logs_for_pods
from app.kubernetes.events_analyzer import analyze_events
from app.kubernetes.deployment_inspector import inspect_deployments
from app.kubernetes.network_inspector import inspect_network

def run_cluster_investigation(investigation_id: str = None, user_id: str = None, context: str = None) -> Dict[str, Any]:
    logger.info(f"Triggering orchestrator run_cluster_investigation (context={context})...")
    
    def log_step(step: str, status: str):
        if investigation_id and user_id:
            from app.core.database import log_investigation_step
            log_investigation_step(investigation_id, user_id, step, status)

    # 1. Check Pods
    log_step("pods", "running")
    try:
        pods_report = inspect_pods(context=context)
        log_step("pods", "success")
    except Exception as e:
        logger.error(f"Error checking pods: {e}")
        pods_report = {"healthy": False, "error": str(e)}
        log_step("pods", "failed")

    problematic_pods = pods_report.get("problematic_pods", [])
    
    # 2. Collect Logs
    log_step("logs", "running")
    try:
        logs_report = {}
        if problematic_pods:
            logs_report = collect_logs_for_pods(problematic_pods, context=context)
        else:
            logger.info("No problematic pods detected. Skipping logs collection.")
        log_step("logs", "success")
    except Exception as e:
        logger.error(f"Error collecting logs: {e}")
        logs_report = {"error": str(e)}
        log_step("logs", "failed")
        
    # 3. Analyze Events
    log_step("events", "running")
    try:
        events_report = analyze_events(context=context)
        log_step("events", "success")
    except Exception as e:
        logger.error(f"Error analyzing events: {e}")
        events_report = {"success": False, "error": str(e)}
        log_step("events", "failed")
    
    # 4. Inspect Deployments
    log_step("deployments", "running")
    try:
        deployments_report = inspect_deployments(context=context)
        log_step("deployments", "success")
    except Exception as e:
        logger.error(f"Error inspecting deployments: {e}")
        deployments_report = {"success": False, "error": str(e)}
        log_step("deployments", "failed")
    
    # 5. Check Networking
    log_step("network", "running")
    try:
        network_report = inspect_network(context=context)
        log_step("network", "success")
    except Exception as e:
        logger.error(f"Error checking network: {e}")
        network_report = {"success": False, "error": str(e)}
        log_step("network", "failed")
    
    logger.info("Cluster investigation completed successfully.")
    
    return {
        "pods": pods_report,
        "logs": logs_report,
        "events": events_report,
        "deployments": deployments_report,
        "network": network_report
    }

