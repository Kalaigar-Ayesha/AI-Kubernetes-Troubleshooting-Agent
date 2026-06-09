import psycopg2
from psycopg2.extras import RealDictCursor
from app.core.config import settings
from loguru import logger
import datetime

def get_db_connection():
    if not settings.database_url:
        logger.warning("No DATABASE_URL configured; database operations will be skipped")
        return None
    try:
        conn = psycopg2.connect(settings.database_url)
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        return None

def create_investigation(user_id: str, namespace: str = "default") -> str:
    conn = get_db_connection()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.investigation (user_id, namespace, status, root_cause, confidence, timestamp)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id;
                """,
                (user_id, namespace, "running", "", 0, datetime.datetime.now(datetime.timezone.utc))
            )
            investigation_id = cur.fetchone()[0]
            conn.commit()
            return str(investigation_id)
    except Exception as e:
        logger.error(f"Failed to create investigation in DB: {e}")
        return None
    finally:
        conn.close()

def update_investigation(investigation_id: str, status: str, root_cause: str, confidence: int):
    conn = get_db_connection()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.investigation
                SET status = %s, root_cause = %s, confidence = %s
                WHERE id = %s;
                """,
                (status, root_cause, confidence, investigation_id)
            )
            conn.commit()
    except Exception as e:
        logger.error(f"Failed to update investigation in DB: {e}")
    finally:
        conn.close()

def log_investigation_step(investigation_id: str, user_id: str, step: str, status: str):
    conn = get_db_connection()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            # Check if step already exists for this investigation
            cur.execute(
                "SELECT id FROM public.investigation_process WHERE investigation_id = %s AND step = %s;",
                (investigation_id, step)
            )
            row = cur.fetchone()
            now = datetime.datetime.now(datetime.timezone.utc)
            if row:
                # Update
                cur.execute(
                    """
                    UPDATE public.investigation_process
                    SET status = %s, updated_at = %s
                    WHERE id = %s;
                    """,
                    (status, now, row[0])
                )
            else:
                # Insert
                cur.execute(
                    """
                    INSERT INTO public.investigation_process (investigation_id, user_id, step, status, updated_at)
                    VALUES (%s, %s, %s, %s, %s);
                    """,
                    (investigation_id, user_id, step, status, now)
                )
            conn.commit()
    except Exception as e:
        logger.error(f"Failed to log step '{step}' status '{status}' in DB: {e}")
    finally:
        conn.close()
