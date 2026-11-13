import threading
import numpy as np

_model = None
_lock = threading.Lock()

def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from fastembed import TextEmbedding
                _model = TextEmbedding("BAAI/bge-small-en-v1.5")
    return _model

def embed(texts):
    """str -> 1D normalized vector; list[str] -> 2D array."""
    single = isinstance(texts, str)
    batch = [texts] if single else list(texts)
    vecs = np.array(list(_get_model().embed(batch)), dtype=np.float32)
    vecs /= (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-12)
    return vecs[0] if single else vecs