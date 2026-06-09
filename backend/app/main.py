from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.core.config import settings
from app.core.logging import setup_logging

# Setup structured logging
setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up AI Kubernetes Troubleshooting Agent API service...")
    logger.info(f"Configured OpenRouter Model: {settings.openrouter_model}")
    if settings.kubeconfig_path:
        logger.info(f"Configured Kubeconfig Path: {settings.kubeconfig_path}")
    else:
        logger.warning("No Kubeconfig Path configured; using cluster defaults or empty config")
    yield
    logger.info("Shutting down AI Kubernetes Troubleshooting Agent API service...")

app = FastAPI(
    title="AI Kubernetes Troubleshooting Agent Backend",
    version="0.1.0",
    lifespan=lifespan
)

# Enable CORS for frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to the frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.services.investigation import run_cluster_investigation
from app.ai.reasoning import analyze_cluster_issues
from app.kubernetes.executor import get_contexts

@app.get("/health")
async def health_check():
    logger.info("Health check endpoint hit")
    return {
        "status": "healthy",
        "service": "ai-kubernetes-agent"
    }

@app.get("/clusters")
async def list_clusters():
    logger.info("Clusters endpoint hit")
    try:
        data = get_contexts()
        return {
            "status": "success",
            "contexts": data.get("contexts", []),
            "current_context": data.get("current_context", "")
        }
    except Exception as e:
        logger.error(f"Failed to retrieve contexts: {e}")
        return {
            "status": "error",
            "message": str(e)
        }

@app.post("/investigate")
async def investigate_cluster(user_id: str = None, namespace: str = "default", context: str = None):
    logger.info(f"Received request to investigate cluster. User ID: {user_id}, Namespace: {namespace}, Context: {context}")
    
    investigation_id = None
    if user_id:
        from app.core.database import create_investigation, update_investigation, log_investigation_step
        try:
            investigation_id = create_investigation(user_id, namespace)
            logger.info(f"Created database investigation record: {investigation_id}")
        except Exception as e:
            logger.error(f"Failed to initialize investigation in DB: {e}")
            
    try:
        # Start Kubernetes evidence collection
        evidence = run_cluster_investigation(investigation_id=investigation_id, user_id=user_id, context=context)
        
        # Start AI Reasoning
        if investigation_id and user_id:
            log_investigation_step(investigation_id, user_id, "ai_reasoning", "running")
            
        diagnosis = await analyze_cluster_issues(evidence)
        
        if investigation_id and user_id:
            log_investigation_step(investigation_id, user_id, "ai_reasoning", "success")
            # Save the final result as JSON serialized in root_cause
            import json
            update_investigation(investigation_id, "success", json.dumps(diagnosis), diagnosis.get("confidence", 0))
            logger.info(f"Updated database investigation {investigation_id} with success status")
            
        return {
            "status": "success",
            "investigation_id": investigation_id,
            "investigation": evidence,
            "diagnosis": diagnosis
        }
    except Exception as e:
        logger.exception("Failed to run cluster investigation")
        if investigation_id and user_id:
            try:
                log_investigation_step(investigation_id, user_id, "ai_reasoning", "failed")
                update_investigation(investigation_id, "failed", str(e), 0)
            except Exception as dbe:
                logger.error(f"Failed to log exception to DB: {dbe}")
        return {
            "status": "error",
            "message": str(e)
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
