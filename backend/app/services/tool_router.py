# app/services/tool_router.py
import numpy as np
from app.ai.embedder import embed

# Load your local embedding model once on startup
embedding_model = SentenceTransformer("BAAI/bge-small-en-v1.5")

class DynamicToolRouter:
    def __init__(self, all_tools: list[dict], always_include: list[str] = None):
        """
        :param all_tools: Full list of OpenAI/FastAPI tool schemas.
        :param always_include: List of tool names that must be present in every request.
        """
        self.all_tools = {tool["function"]["name"]: tool for tool in all_tools}
        self.always_include = always_include or ["run_terminal_command"]
        
        # 1. Build a searchable text representation for each tool
        self.tool_names = list(self.all_tools.keys())
        self.tool_descriptions = [
            f"{name}: {self.all_tools[name]['function'].get('description', '')}"
            for name in self.tool_names
        ]
        
        # 2. Pre-compute and cache tool embeddings in memory
        self.tool_embeddings = embed(self.tool_descriptions)      # line 25

    def select_tools(self, user_prompt: str, top_k: int = 3) -> list[dict]:
        """Returns only the top_k most relevant tool schemas for the given prompt."""
        if not user_prompt or not self.all_tools:
            return []

        # Embed user prompt
        prompt_embedding = embed(user_prompt)  
        
        # Cosine similarity dot product (normalized vectors)
        similarities = np.dot(self.tool_embeddings, prompt_embedding)
        
        # Get indices of top_k highest similarity scores
        top_indices = np.argsort(similarities)[::-1][:top_k]
        
        selected_tool_names = set(self.always_include)
        
        # Add top matched tools if their similarity score passes a minimum threshold (0.25)
        for idx in top_indices:
            if similarities[idx] > 0.25:
                selected_tool_names.add(self.tool_names[idx])

        # Return filtered array of tool schemas
        return [self.all_tools[name] for name in selected_tool_names if name in self.all_tools]