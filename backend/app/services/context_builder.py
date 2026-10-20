# app/services/context_builder.py
import os
import math
import json
import subprocess
import urllib.request
from app.db.database import get_database

db = get_database()

# Set the path to your skills folder (assumes 'skills' is in your project root)
SKILLS_DIR = os.path.join(os.getcwd(), "skills")


def get_vscode_context() -> dict | None:
    """Fetches real-time code, selections, and diagnostics from local VS Code extension."""
    url = "http://127.0.0.1:3003/context"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Jarvis-Agent"})
        with urllib.request.urlopen(req, timeout=0.2) as response:
            if response.status == 200:
                vscode_data = json.loads(response.read().decode("utf-8"))
                vscode_context_str = (
                    "VS Code is not actively focused or extension is idle."
                )

                if vscode_data and vscode_data.get("activeFile"):
                    file_info = vscode_data["activeFile"]
                    diags = vscode_data.get("diagnostics", [])

                    vscode_context_str = f"""
                    - Active File: {file_info['fileName']}          ({file_info['languageId']})
                    - Cursor at: Line {file_info['cursorPosition']          ['line']}, Col {file_info['cursorPosition']         ['character']}
                    - Active Selection: {file_info['selectedText']          if file_info['selectedText'] else "None"}
                    - Open Errors/Warnings: {json.dumps(diags) if           diags else "No active errors"}
                    - Open Tabs: {', '.join([os.path.basename(t)            for t in vscode_data.get('openTabs', [])])}

                    --- FILE CONTENT SNAPSHOT ---
                    {file_info['content'][:4000]}  # First 4000             chars for context window safety
                    --- END CONTENT SNAPSHOT ---
                    """
                return vscode_context_str
    except Exception:
        return None
    return None


def get_active_window_info() -> str:
    """Gets the active macOS application name and front window title."""
    script = """
    tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        set windowName to ""
        try
            tell process frontApp to set windowName to name of window 1
        end try
        return frontApp & " | " & windowName
    end tell
    """
    try:
        output = subprocess.check_output(["osascript", "-e", script]).decode().strip()
        return output if output else "Desktop / No active window"
    except Exception:
        return "Unknown"


def get_relevant_skills(prompt: str) -> str:
    """Dynamically scans all Markdown skill files in skills/ and injects relevant ones."""
    if not prompt or not os.path.exists(SKILLS_DIR):
        return ""

    prompt_lower = prompt.lower()
    injected_skills_text = ""

    for filename in os.listdir(SKILLS_DIR):
        if filename.endswith(".md"):
            skill_path = os.path.join(SKILLS_DIR, filename)
            skill_keyword = filename.replace(".md", "").replace("_", " ").lower()

            # Check if the prompt mentions the skill name directly or keywords inside the file header
            try:
                with open(skill_path, "r", encoding="utf-8") as f:
                    content = f.read()

                # Match if skill filename is in user prompt OR header matches
                if skill_keyword in prompt_lower or any(word in prompt_lower for word in skill_keyword.split()):
                    injected_skills_text += f"\n\n--- START INJECTED SKILL: {filename} ---\n"
                    injected_skills_text += content
                    injected_skills_text += f"\n--- END INJECTED SKILL: {filename} ---\n"
            except Exception as e:
                print(f"Warning: Could not read skill {filename}: {e}")

    return injected_skills_text

def cosine_similarity(vec1: list[float], vec2: list[float]) -> float:
    """Calculates semantic similarity between two vectors."""
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    mag1 = math.sqrt(sum(a * a for a in vec1))
    mag2 = math.sqrt(sum(b * b for b in vec2))
    return dot_product / (mag1 * mag2) if mag1 and mag2 else 0.0


async def build_agent_context(
    user_id: str, prompt: str, prompt_embedding: list[float] = None
) -> str:
    """Combines user preferences, memories, active screen context, and dynamic skills."""

    # 1. Get current active window info from macOS
    active_window = get_active_window_info()
    vscode_data = get_vscode_context()

    # 2. Fetch Preferences
    prefs = await db["user_preferences"].find_one({"user_id": user_id})
    defaults = prefs.get("defaults", {}) if prefs else {}

    # 3. Fetch and rank memories using vector similarity
    memories_cursor = db["agent_memories"].find({"user_id": user_id})
    all_memories = await memories_cursor.to_list(length=500)

    if prompt_embedding:
        for m in all_memories:
            mem_embed = m.get("embeddings", [])
            m["similarity"] = cosine_similarity(prompt_embedding, mem_embed)

        all_memories.sort(key=lambda x: x.get("similarity", 0.0), reverse=True)
        top_memories = all_memories[:5]
    else:
        top_memories = all_memories[:5]

    memory_facts = [f"- {m['key']}: {m['value']}" for m in top_memories]

    # 4. Construct System Context Prompt
    system_context = f"""
    You are an autonomous AI workflow assistant running natively on macOS.
    
    [CURRENT ACTIVE WORKSPACE / WINDOW]
    - Frontmost App & Window: {active_window}

    [USER PREFERENCES]
    - Default YouTube Privacy: {defaults.get('youtube_privacy', 'unlisted')}
    - Default Hashtags: {', '.join(defaults.get('default_tags', []))}
    - Email Signature: {defaults.get('default_email_signature', 'Sent by AI Agent')}

    [STORED LONG-TERM MEMORIES & FACTS]
    {chr(10).join(memory_facts) if memory_facts else "No prior memories recorded."}
    
    [CRITICAL RULE 1: FILE OPERATIONS]
    When a user asks to modify, move, or rename files:
    1. First, list the files if you don't know their exact names.
    2. SECOND (Mandatory): You MUST invoke the 'manage_local_files' tool. 
    3. NEVER output raw terminal commands (like 'mv' or 'cp') to the user. Always use the tool.
    
    [CRITICAL RULE 2: MACOS AUTOMATION & UI CONTROL (STRICT HIERARCHY)]
    You are running on macOS. Programmatic control is ALWAYS preferred. NEVER use screenshots or GUI automation for simple app navigation or web searches.
    
    Follow this exact hierarchy for desktop tasks:
    
    PRIORITY 1: OPENING APPS OR FILES
    If asked to simply open an app (e.g., "Open Postman") or file, immediately use `manage_local_files` with `action="open"`.
    
    PRIORITY 2: CLIs, SCRIPTS & SKILLS (NO VISION ALLOWED)
    - Always check if a relevant CLI tool (e.g., 'gh' for GitHub) is installed before attempting browser automation.
    - For simple web searches: Format the URL and use `run_terminal_command`. (e.g., open "https://github.com")
    - If a specific Skill file (.md) is injected into this context, follow its instructions precisely to execute the task.
      
    PRIORITY 3: CONTROLLING APP DATA 
    To draft emails, create notes, or control media playback, write and execute AppleScript. 
    Step 1: Write an .scpt file using `manage_local_files` (action="write").
    Step 2: Run it using `run_terminal_command` (osascript filename.scpt).
    
    [CRITICAL RULE 3: AUTO-SKILL GENERATION]
    When you successfully solve a task involving a new CLI tool, complex AppleScript, or API that isn't already documented in your skills:
    1. Complete the user's task first.
    2. Call `save_new_skill` to record the exact syntax, flags, and steps in `skills/<skill_name>.md`.
    3. Never store personal credentials or keys in skills—only reusable command patterns and flags.
    
    [VS CODE INTERNAL LIVE CONTEXT]
    {vscode_data}
    
    LAST RESORT: SCREENSHOTS & GUI (ONLY WHEN FORCED)
    Only use `take_screenshot` and `handle_gui_action` if programmatic methods fail, or if the user explicitly asks to "use vision" or click specific screen coordinates. 
    *Note: When using handle_gui_action for shortcuts, ALWAYS use 'command' (or 'cmd') instead of 'ctrl'.*
    """

    # 5. Inject Dynamic Skills based on prompt
    active_skills = get_relevant_skills(prompt)
    if active_skills:
        system_context += f"\n\n[ACTIVE SKILLS LOADED FOR THIS REQUEST]{active_skills}"

    return system_context
