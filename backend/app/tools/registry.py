# app/tools/registry.py
import importlib.util
import inspect
from pathlib import Path
from typing import Dict, Any, Callable, List

GENERATED_TOOLS_DIR = Path("./app/tools/generated").resolve()
GENERATED_TOOLS_DIR.mkdir(parents=True, exist_ok=True)

# Shared live registries updated at runtime
DYNAMIC_TOOL_SCHEMAS: List[Dict[str, Any]] = []
DYNAMIC_TOOL_FUNCTIONS: Dict[str, Callable] = {}


def register_tool_function(
    name: str, 
    func: Callable, 
    schema: Dict[str, Any]
) -> None:
    """Registers a newly synthesized tool into live memory."""
    DYNAMIC_TOOL_FUNCTIONS[name] = func
    
    # Remove existing schema version if updating
    global DYNAMIC_TOOL_SCHEMAS
    DYNAMIC_TOOL_SCHEMAS = [
        s for s in DYNAMIC_TOOL_SCHEMAS 
        if s.get("function", {}).get("name") != name
    ]
    DYNAMIC_TOOL_SCHEMAS.append(schema)
    print(f"🧩 [Tool Registry] Live registered new tool: '{name}'")


def load_all_generated_tools() -> None:
    """Scans and loads all previously synthesized tools on startup."""
    for file_path in GENERATED_TOOLS_DIR.glob("*.py"):
        if file_path.name.startswith("__"):
            continue
        try:
            module_name = f"app.tools.generated.{file_path.stem}"
            spec = importlib.util.spec_from_file_location(module_name, file_path)
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                
                # Load exported schema and handler function
                tool_name = getattr(mod, "TOOL_NAME", file_path.stem)
                schema = getattr(mod, "TOOL_SCHEMA", None)
                handler = getattr(mod, "run_tool", None)
                
                if schema and handler:
                    register_tool_function(tool_name, handler, schema)
        except Exception as e:
            print(f"⚠️ Failed to auto-load generated tool '{file_path.name}': {e}")