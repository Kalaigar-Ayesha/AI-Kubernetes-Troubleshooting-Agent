from typing import Dict, Any, List, Optional
from loguru import logger
from app.kubernetes.executor import execute_kubectl

def inspect_deployments(context: Optional[str] = None) -> Dict[str, Any]:
    logger.info("Starting Deployment inspection...")
    result = execute_kubectl(["get", "deployments", "-A", "-o", "json"], context=context)
    
    if not result.success:
        return {
            "success": False,
            "error": f"Failed to retrieve deployments: {result.stderr}",
            "unhealthy_deployments": []
        }
        
    data = result.json_stdout()
    if not data or "items" not in data:
        return {
            "success": True,
            "unhealthy_deployments": [],
            "message": "No deployments found in the cluster."
        }
        
    unhealthy_deployments = []
    total_deployments = 0
    
    for item in data.get("items", []):
        total_deployments += 1
        metadata = item.get("metadata", {})
        name = metadata.get("name", "unknown")
        namespace = metadata.get("namespace", "unknown")
        
        spec = item.get("spec", {})
        status = item.get("status", {})
        
        desired_replicas = spec.get("replicas", 1)
        ready_replicas = status.get("readyReplicas", 0)
        available_replicas = status.get("availableReplicas", 0)
        unavailable_replicas = status.get("unavailableReplicas", 0)
        
        conditions = status.get("conditions", [])
        is_failing_rollout = False
        rollout_reason = ""
        
        for cond in conditions:
            if cond.get("type") == "Progressing" and cond.get("status") == "False":
                is_failing_rollout = True
                rollout_reason = cond.get("reason", "Unknown")
                
        is_unhealthy = (
            desired_replicas != ready_replicas or
            desired_replicas != available_replicas or
            unavailable_replicas > 0 or
            is_failing_rollout
        )
        
        if is_unhealthy:
            unhealthy_deployments.append({
                "name": name,
                "namespace": namespace,
                "desired_replicas": desired_replicas,
                "ready_replicas": ready_replicas,
                "available_replicas": available_replicas,
                "unavailable_replicas": unavailable_replicas,
                "is_failing_rollout": is_failing_rollout,
                "rollout_failure_reason": rollout_reason,
                "conditions": [
                    {
                        "type": c.get("type"),
                        "status": c.get("status"),
                        "reason": c.get("reason"),
                        "message": c.get("message")
                    } for c in conditions
                ]
            })
            
    logger.info(f"Deployment inspection completed: {total_deployments} total, {len(unhealthy_deployments)} unhealthy.")
    return {
        "success": True,
        "total_deployments_count": total_deployments,
        "unhealthy_deployments": unhealthy_deployments
    }
