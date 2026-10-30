# app/ai/tool_synthesizer.py
import ast
import asyncio
import os
import subprocess
import sys
import importlib.util
from pathlib import Path
from typing import Dict, Any
from pydantic import BaseModel, Field

from app.tools.registry import register_tool_function, GENERATED_TOOLS_DIR

# Import your custom model client and config
from app.ai.openai import get_async_openai_client
from app.ai.config import config


class GeneratedToolCode(BaseModel):
    tool_name: str = Field(description="Snake_case function name (e.g., 'fetch_jira_tickets').")
    description: str = Field(description="Clear explanation of what the tool does for the LLM.")
    python_code: str = Field(
        description="Complete Python module code containing `run_tool(**kwargs) -> str`, `TOOL_SCHEMA`, and `TOOL_NAME`."
    )
    test_kwargs: Dict[str, Any] = Field(
        description="Sample keyword arguments to run a dry-run test execution."
    )


async def synthesize_and_register_tool(tool_requirement: str) -> Dict[str, Any]:
    """
    Writes a new Python tool, validates syntax, tests in subprocess, and loads it into memory.
    """
    print(f"🧬 [Tool Synthesizer] Writing new tool for: '{tool_requirement}'...")

    system_prompt = """
    You are an expert Python tool developer for an autonomous AI assistant.
    Write a clean, self-contained Python script to solve the requested task.

    MANDATORY SCRIPT STRUCTURE:
1. Must define `TOOL_NAME = "your_tool_name"`
    2. Must define `TOOL_SCHEMA` matching standard OpenAI function calling format.
    3. Must define `def run_tool(**kwargs) -> str:` as the primary execution handler.
    4. Code must handle exceptions internally and return structured text/JSON string.
    5. Avoid interactive inputs (`input()`) and GUI popups.
    """

    try:
        # Use your custom model client
        client = get_async_openai_client()
        
        # 1. Generate Tool Code via GPT-4o Structured Outputs
        response = await client.beta.chat.completions.parse(
            model=config.azure_openai_deployment or "gpt-4o",  # Fallback to your defined model
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Requirement: {tool_requirement}"}
            ],
            response_format=GeneratedToolCode
        )
        tool_data = response.choices[0].message.parsed
        tool_name = tool_data.tool_name
        code = tool_data.python_code

        # 2. Syntax Validation Check
        try:
            ast.parse(code)
        except SyntaxError as syn_err:
            return {"status": "error", "error": f"Generated code syntax error: {str(syn_err)}"}

        # 3. Save Code to Workspace File
        tool_file = GENERATED_TOOLS_DIR / f"{tool_name}.py"
        with open(tool_file, "w", encoding="utf-8") as f:
            f.write(code)

        # 4. Isolated Subprocess Dry-Run Test
        test_script = f"""
import sys
from app.tools.generated.{tool_name} import run_tool
args = {tool_data.test_kwargs}
result = run_tool(**args)
print("TEST_SUCCESS:" + str(result))
"""
        test_file = GENERATED_TOOLS_DIR / f"_test_{tool_name}.py"
        with open(test_file, "w", encoding="utf-8") as f:
            f.write(test_script)

        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(test_file),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()

        # Clean up test runner file
        if test_file.exists():
            test_file.unlink()

        output = stdout.decode("utf-8")
        if proc.returncode != 0 or "TEST_SUCCESS:" not in output:
            err_msg = stderr.decode("utf-8") or output
            if tool_file.exists():
                tool_file.unlink()  # Discard bad code
            return {"status": "error", "error": f"Tool dry-run test failed: {err_msg}"}

        # 5. Load into Dynamic Memory
        spec = importlib.util.spec_from_file_location(f"app.tools.generated.{tool_name}", tool_file)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        register_tool_function(
            name=tool_name,
            func=mod.run_tool,
            schema=mod.TOOL_SCHEMA
        )

        return {
            "status": "success",
            "tool_name": tool_name,
            "message": f"Successfully synthesized, tested, and registered '{tool_name}' tool."
        }

    except Exception as e:
        return {"status": "error", "error": f"Tool synthesis failed: {str(e)}"}