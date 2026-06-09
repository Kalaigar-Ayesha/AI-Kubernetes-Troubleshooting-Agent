from typing import Dict, Any, List, Optional
from loguru import logger
from app.kubernetes.executor import execute_kubectl

def get_pod_status_details(pod: Dict[str, Any]) -> str:
    status = pod.get("status", {})
    phase = status.get("phase", "Unknown")
    
    container_statuses = status.get("containerStatuses", [])
    for cs in container_statuses:
        state = cs.get("state", {})
        if "waiting" in state:
            return state["waiting"].get("reason", "Waiting")
        if "terminated" in state:
            return state["terminated"].get("reason", "Terminated")
            
    init_container_statuses = status.get("initContainerStatuses", [])
    for ics in init_container_statuses:
        state = ics.get("state", {})
        if "waiting" in state:
            return f"Init:{state['waiting'].get('reason', 'Waiting')}"
        if "terminated" in state:
            reason = state["terminated"].get("reason", "Terminated")
            if reason != "Completed":
                return f"Init:{reason}"
                
    return phase

def inspect_pods(context: Optional[str] = None) -> Dict[str, Any]:
    logger.info("Starting Pod investigation...")
    result = execute_kubectl(["get", "pods", "-A", "-o", "json"], context=context)
    
    if not result.success:
        return {
            "healthy": False,
            "error": f"Failed to retrieve pods: {result.stderr}",
            "problematic_pods": []
        }
        
    data = result.json_stdout()
    if not data or "items" not in data:
        return {
            "healthy": True,
            "problematic_pods": [],
            "message": "No pods found in the cluster."
        }
        
    problematic_pods = []
    total_pods = 0
    
    for item in data.get("items", []):
        total_pods += 1
        metadata = item.get("metadata", {})
        name = metadata.get("name", "unknown")
        namespace = metadata.get("namespace", "unknown")
        
        status_str = get_pod_status_details(item)
        
        status_obj = item.get("status", {})
        phase = status_obj.get("phase", "Unknown")
        
        container_statuses = status_obj.get("containerStatuses", [])
        all_containers_ready = len(container_statuses) > 0 and all(cs.get("ready", False) for cs in container_statuses)
        
        is_pod_healthy = (phase == "Succeeded") or (phase == "Running" and all_containers_ready)
        
        unhealthy_reasons = [
            "CrashLoopBackOff", "ImagePullBackOff", "Pending", "Error", 
            "OOMKilled", "ContainerCreating", "ErrImagePull", "CreateContainerConfigError"
        ]
        
        is_unhealthy_status = any(term.lower() in status_str.lower() for term in unhealthy_reasons)
        
        if not is_pod_healthy or is_unhealthy_status:
            problematic_pods.append({
                "name": name,
                "namespace": namespace,
                "status": status_str,
                "phase": phase,
                "restarts": sum(cs.get("restartCount", 0) for cs in container_statuses)
            })
            
    is_overall_healthy = len(problematic_pods) == 0
    logger.info(f"Pod investigation completed: {total_pods} total pods, {len(problematic_pods)} unhealthy pods.")
    
    return {
        "healthy": is_overall_healthy,
        "total_pods_count": total_pods,
        "problematic_pods": problematic_pods
    }
