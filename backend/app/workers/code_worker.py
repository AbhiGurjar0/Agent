# app/workers/coder_worker.py
import subprocess
from pathlib import Path
import re
from openai import AsyncOpenAI
from app.ai.config import config

WORKSPACE_DIR = Path("./workspace")
WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

async def run_coder_worker(task_description: str) -> str:
    """
    1. Asks an LLM to write a clean Python script for the task.
    2. Saves it to a file.
    3. Executes it via subprocess.
    """
    client = AsyncOpenAI(api_key=config.openai_api_key) # Or your active client
    
    # Prompt LLM to write the script
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are an expert Python automation engineer. Write a complete, standalone Python script that accomplishes the user's task using standard libraries or popular tools like yt-dlp/requests/playwright. Return ONLY markdown python code blocks."},
            {"role": "user", "content": task_description}
        ]
    )
    
    generated_text = response.choices[0].message.content
    code_match = re.search(r"```python\s*(.*?)\s*```", generated_text, re.DOTALL)
    script_code = code_match.group(1) if code_match else generated_text

    # Save to workspace file
    script_path = WORKSPACE_DIR / "dynamic_op.py"
    script_path.write_text(script_code)
    print(f"💻 [CoderWorker] Saved dynamic script to {script_path}")

    try:
        # Run the script
        result = subprocess.run(
            ["python", str(script_path)],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode != 0:
            return f"Script execution failed with error:\n{result.stderr.strip()}"
        
        return f"Script executed successfully. Output:\n{result.stdout.strip()}"
        
    except Exception as e:
        return f"Execution error: {str(e)}"