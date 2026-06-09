from typing import Dict, Any, List, Optional
from loguru import logger
from app.kubernetes.executor import execute_kubectl

def analyze_events(context: Optional[str] = None) -> Dict[str, Any]:
    logger.info("Starting Events analysis...")
    result = execute_kubectl(["get", "events", "-A", "-o", "json"], context=context)
    
    if not result.success:
        return {
            "success": False,
            "error": f"Failed to retrieve events: {result.stderr}",
            "critical_events": []
        }
        
    data = result.json_stdout()
    if not data or "items" not in data:
        return {
            "success": True,
            "critical_events": [],
            "message": "No events found in the cluster."
        }
        
    critical_events = []
    warning_reasons = [
        "FailedScheduling", "BackOff", "FailedMount", "FailedPull",
        "ErrImagePull", "Unhealthy", "FailedCreatePodSandBox", "Failed"
    ]
    
    for item in data.get("items", []):
        reason = item.get("reason", "")
        message = item.get("message", "")
        type_str = item.get("type", "Normal")
        
        involved_object = item.get("involvedObject", {})
        obj_kind = involved_object.get("kind", "")
        obj_name = involved_object.get("name", "")
        obj_ns = involved_object.get("namespace", "default")
        
        is_critical_reason = any(r.lower() in reason.lower() for r in warning_reasons)
        
        if type_str.lower() == "warning" or is_critical_reason:
            critical_events.append({
                "reason": reason,
                "message": message,
                "type": type_str,
                "object_kind": obj_kind,
                "object_name": obj_name,
                "namespace": obj_ns,
                "count": item.get("count", 1),
                "first_timestamp": item.get("firstTimestamp", ""),
                "last_timestamp": item.get("lastTimestamp", "")
            })
            
    critical_events = sorted(
        critical_events, 
        key=lambda x: x.get("last_timestamp") or x.get("first_timestamp") or "", 
        reverse=True
    )[:30]
    
    logger.info(f"Events analysis completed: {len(critical_events)} warning/critical events identified.")
    return {
        "success": True,
        "critical_events_count": len(critical_events),
        "critical_events": critical_events
    }
