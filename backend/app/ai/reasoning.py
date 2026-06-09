import json
import httpx
from typing import Dict, Any
from loguru import logger

from app.core.config import settings

def clean_json_response(raw_response: str) -> str:
    text = raw_response.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```json") or lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text

async def analyze_cluster_issues(investigation_results: Dict[str, Any]) -> Dict[str, Any]:
    logger.info("Initializing AI reasoning engine...")
    
    api_key = settings.openrouter_api_key
    model = settings.openrouter_model or "meta-llama/llama-3-8b-instruct:free"
    
    if not api_key:
        logger.warning("OPENROUTER_API_KEY is not configured. Falling back to Mock SRE response.")
        return get_mock_sre_diagnosis(investigation_results)
        
    system_prompt = (
        "You are a Senior Kubernetes Site Reliability Engineer (SRE).\n"
        "Your task is to analyze the provided Kubernetes diagnostic evidence (pods, logs, events, deployments, network) "
        "and output a structured root-cause analysis and suggested fixes.\n\n"
        "You MUST respond ONLY with a valid JSON object matching the following structure:\n"
        "{\n"
        '  "root_cause": "A concise description of the root cause.",\n'
        '  "explanation": "A detailed explanation of why this error is occurring, correlating the logs, events, and resources.",\n'
        '  "fix": "Actionable, step-by-step fix recommendations.",\n'
        '  "kubectl_command": "A specific, practical kubectl command (e.g. kubectl edit deployment <name> -n <namespace>) to apply the fix.",\n'
        '  "prevention": "A recommendation to prevent this issue from happening again.",\n'
        '  "confidence": 92\n'
        "}\n\n"
        "Do not include any intro, outro, or explanation outside of the JSON block. Ensure the JSON is valid."
    )
    
    user_prompt = f"Kubernetes cluster diagnostic evidence:\n{json.dumps(investigation_results, indent=2)}"
    
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "AI Kubernetes Troubleshooting Agent"
    }
    
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2
    }
    
    limits = httpx.Limits(max_keepalive_connections=5, max_connections=10)
    timeout = httpx.Timeout(15.0, connect=5.0)
    
    async with httpx.AsyncClient(limits=limits, timeout=timeout) as client:
        for attempt in range(3):
            try:
                logger.info(f"Sending request to OpenRouter (Attempt {attempt + 1}/3)...")
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                
                response_data = response.json()
                choices = response_data.get("choices", [])
                if not choices:
                    raise ValueError("Empty choices returned from OpenRouter completions API.")
                    
                content = choices[0].get("message", {}).get("content", "")
                cleaned_content = clean_json_response(content)
                
                try:
                    diagnosis = json.loads(cleaned_content)
                    logger.info("AI SRE Diagnosis generated successfully.")
                    return diagnosis
                except json.JSONDecodeError as je:
                    logger.error(f"Failed to parse model content as JSON. Content: {content[:300]}")
                    raise ValueError(f"Model did not return valid JSON: {str(je)}")
                    
            except (httpx.HTTPStatusError, httpx.RequestError, ValueError) as e:
                logger.warning(f"Attempt {attempt + 1} failed: {str(e)}")
                if attempt == 2:
                    logger.error("All OpenRouter attempts failed. Falling back to Mock SRE response.")
                    return get_mock_sre_diagnosis(investigation_results)
                    
    return get_mock_sre_diagnosis(investigation_results)

def get_mock_sre_diagnosis(evidence: Dict[str, Any]) -> Dict[str, Any]:
    logger.info("Generating mock Senior SRE diagnosis response.")
    
    pods_report = evidence.get("pods", {})
    problematic_pods = pods_report.get("problematic_pods", [])
    
    if problematic_pods:
        first_pod = problematic_pods[0]
        pod_name = first_pod.get("name", "unknown")
        namespace = first_pod.get("namespace", "default")
        status = first_pod.get("status", "CrashLoopBackOff")
        
        return {
            "root_cause": f"Application container in pod '{pod_name}' is crashing during initialization (Status: {status}).",
            "explanation": f"The pod '{pod_name}' in namespace '{namespace}' is reporting state '{status}'. "
                           "This is typically caused by a failing main process entrypoint, missing environment variables, "
                           "or connection timeouts to dependent services (such as a database or cache).",
            "fix": "1. Inspect container logs with '--previous' to find startup stack trace.\n"
                   "2. Verify all required environment variables and secrets are correctly mapped.\n"
                   "3. Check network access to external databases or dependent services.",
            "kubectl_command": f"kubectl logs {pod_name} -n {namespace} --previous",
            "prevention": "Implement robust readiness/liveness probes and inject configuration checks before app boot.",
            "confidence": 85
        }
        
    network_report = evidence.get("network", {})
    network_issues = network_report.get("network_issues", [])
    if network_issues:
        first_issue = network_issues[0]
        svc_name = first_issue.get("service_name", "unknown")
        namespace = first_issue.get("namespace", "default")
        return {
            "root_cause": f"Service selector mismatch or empty endpoints on service '{svc_name}'.",
            "explanation": f"The service '{svc_name}' in namespace '{namespace}' has selector configuration but matches 0 running pods. "
                           "Traffic targeting this service will return HTTP 503 or fail to resolve.",
            "fix": f"1. Audit the pod selectors configured in Service '{svc_name}'.\n"
                   "2. Ensure the pods have matching labels.",
            "kubectl_command": f"kubectl describe svc {svc_name} -n {namespace}",
            "prevention": "Use static label validation schemas or Helm templates to sync service selectors and pod labels.",
            "confidence": 90
        }
        
    return {
        "root_cause": "No obvious Kubernetes resource failures detected in the evidence payload.",
        "explanation": "All inspected pods are running successfully and all service endpoints match their backing pods. "
                       "If users are reporting issues, it may be due to external network routing, ingress rules, "
                       "or application-level logic bugs outside cluster configuration.",
        "fix": "No action required. Check external CDN/Ingress controller configs if external access is failing.",
        "kubectl_command": "kubectl get ingress -A",
        "prevention": "Set up external endpoint synthetic monitoring (uptime tests) to catch routing failures early.",
        "confidence": 95
    }
