# app/tools/skill_writer.py
import os
import re

SKILLS_DIR = os.path.join(os.getcwd(), "skills")

def sanitize_filename(name: str) -> str:
    """Converts skill name to a safe, clean filename (e.g., 'Docker CLI' -> 'docker_cli.md')."""
    clean = re.sub(r"[^\w\s-]", "", name).strip().lower()
    return re.sub(r"[-\s]+", "_", clean) + ".md"

async def save_new_skill(skill_name: str, description: str, rules_and_examples: str) -> dict:
    """Saves a new Markdown skill file to the skills/ directory for future context injection."""
    try:
        os.makedirs(SKILLS_DIR, exist_ok=True)
        filename = sanitize_filename(skill_name)
        file_path = os.path.join(SKILLS_DIR, filename)

        markdown_content = f"""# Skill: {skill_name}

## Description
{description}

## Usage Rules & Workflows
{rules_and_examples}
"""

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(markdown_content)

        return {
            "status": "success",
            "message": f"Successfully created new skill '{skill_name}' at skills/{filename}",
            "filename": filename
        }
    except Exception as e:
        return {"status": "error", "message": f"Failed to save skill: {str(e)}"}