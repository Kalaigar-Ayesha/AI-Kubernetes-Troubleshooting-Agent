from typing import Dict, Any, List, Optional
from loguru import logger
from app.kubernetes.executor import execute_kubectl

def inspect_network(context: Optional[str] = None) -> Dict[str, Any]:
    logger.info("Starting Network inspection...")
    
    svc_result = execute_kubectl(["get", "services", "-A", "-o", "json"], context=context)
    if not svc_result.success:
        return {
            "success": False,
            "error": f"Failed to retrieve services: {svc_result.stderr}",
            "network_issues": []
        }
        
    svc_data = svc_result.json_stdout()
    if not svc_data:
        return {
            "success": True,
            "services": [],
            "network_issues": [],
            "message": "No services found in the cluster."
        }
        
    endpoints_result = execute_kubectl(["get", "endpoints", "-A", "-o", "json"], context=context)
    endpoints_map = {}
    if endpoints_result.success:
        ep_data = endpoints_result.json_stdout() or {}
        for item in ep_data.get("items", []):
            metadata = item.get("metadata", {})
            name = metadata.get("name", "")
            namespace = metadata.get("namespace", "")
            subsets = item.get("subsets", [])
            
            key = f"{namespace}/{name}"
            endpoints_map[key] = subsets
            
    services = []
    network_issues = []
    
    for item in svc_data.get("items", []):
        metadata = item.get("metadata", {})
        name = metadata.get("name", "unknown")
        namespace = metadata.get("namespace", "unknown")
        spec = item.get("spec", {})
        
        selector = spec.get("selector", {})
        cluster_ip = spec.get("clusterIP", "")
        svc_type = spec.get("type", "ClusterIP")
        ports = spec.get("ports", [])
        
        ep_key = f"{namespace}/{name}"
        subsets = endpoints_map.get(ep_key, [])
        
        has_endpoints = len(subsets) > 0
        has_addresses = False
        if has_endpoints:
            for subset in subsets:
                if len(subset.get("addresses", [])) > 0:
                    has_addresses = True
                    break
                    
        is_selector_service = len(selector) > 0
        
        if svc_type != "ExternalName" and is_selector_service and not has_addresses:
            issue = {
                "service_name": name,
                "namespace": namespace,
                "type": "SelectorMismatchOrNoPods",
                "message": f"Service '{name}' has selector {selector} but has no active endpoint addresses. Pods might be failing or selector is mismatched."
            }
            network_issues.append(issue)
            
        services.append({
            "name": name,
            "namespace": namespace,
            "type": svc_type,
            "cluster_ip": cluster_ip,
            "selector": selector,
            "has_active_endpoints": has_addresses,
            "ports": [
                {
                    "name": p.get("name"),
                    "port": p.get("port"),
                    "target_port": p.get("targetPort"),
                    "protocol": p.get("protocol")
                } for p in ports
            ]
        })
        
    logger.info(f"Network inspection completed: {len(services)} services checked, {len(network_issues)} issues found.")
    return {
        "success": True,
        "services": services,
        "network_issues": network_issues
    }
