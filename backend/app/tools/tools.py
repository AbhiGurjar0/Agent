tools = [
    # =====================================================================
    # 1. MEMORY MANAGEMENT TOOLS
    # =====================================================================
    # Memory Tool
    {
        "type": "function",
        "function": {
            "name": "save_memory",
            "description": "Save an important piece of information about the user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "The memory category"},
                    "value": {
                        "type": "string",
                        "description": "The information to remember",
                    },
                },
                "required": ["key", "value"],
            },
        },
    },
    # Search Memory Tool
    {
        "type": "function",
        "function": {
            "name": "search_memory",
            "description": "Search for information in the user's memory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "The memory category"},
                    "value": {
                        "type": "string",
                        "description": "The information to remember",
                    },
                },
                "required": ["key", "value"],
            },
        },
    },
    # =====================================================================
    # 2. TASKS & REMINDERS TOOLS
    # =====================================================================
    # Task Tool
    {
        "type": "function",
        "function": {
            "name": "create_task",
            "description": "Create a new task in the my external app todo list .",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "The title or brief summary of the task.",
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                        "description": "Priority level.",
                    },
                },
                "required": ["title"],
            },
        },
    },
    # Reminder Tool
    {
        "type": "function",
        "function": {
            "name": "create_reminder",
            "description": "Set a reminder notification for a specific date and time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reminder_text": {
                        "type": "string",
                        "description": "What to remind the user about.",
                    },
                    "remind_at": {
                        "type": "string",
                        "description": "Exact date and time in ISO 8601 format (e.g. 2026-10-05T09:00:00).",
                    },
                },
                "required": ["reminder_text", "remind_at"],
            },
        },
    },
    # =====================================================================
    # 3. SOCIAL MEDIA & CONTENT PUBLISHING TOOLS
    # =====================================================================
    # YouTube Upload Tool
    {
        "type": "function",
        "function": {
            "name": "upload_youtube_video",
            "description": "Upload a video file to the user's YouTube channel.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Local absolute file path of the video to upload.",
                    },
                    "title": {"type": "string", "description": "The video title."},
                    "description": {
                        "type": "string",
                        "description": "Detailed video description including links or tags.",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of keywords or tags for the video.",
                    },
                    "privacy_status": {
                        "type": "string",
                        "enum": ["public", "private", "unlisted"],
                        "description": "Visibility of the uploaded video. Defaults to 'private'.",
                    },
                },
                "required": ["file_path", "title", "description"],
            },
        },
    },
    # Instagram Reel Tool
    {
        "type": "function",
        "function": {
            "name": "upload_instagram_reel",
            "description": "Publish a Reel to the user's Instagram Business / Creator account.",
            "parameters": {
                "type": "object",
                "properties": {
                    "video_url": {
                        "type": "string",
                        "description": "Public HTTP URL of the video file.",
                    },
                    "caption": {
                        "type": "string",
                        "description": "Caption and hashtags for the Reel.",
                    },
                },
                "required": ["video_url", "caption"],
            },
        },
    },
    # Facebook Video Tool
    {
        "type": "function",
        "function": {
            "name": "upload_facebook_video",
            "description": "Upload a video to the user's Facebook Page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path_or_url": {
                        "type": "string",
                        "description": "Local file path or video URL.",
                    },
                    "title": {"type": "string", "description": "Facebook post title."},
                    "description": {
                        "type": "string",
                        "description": "Facebook video post description.",
                    },
                },
                "required": ["file_path_or_url", "title", "description"],
            },
        },
    },
    # =====================================================================
    # 4. COMMUNICATION TOOLS
    # =====================================================================
    # Email Tool
    {
        "type": "function",
        "function": {
            "name": "send_email_message",
            "description": "Send an email message to a recipient.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to_email": {
                        "type": "string",
                        "description": "Recipient email address.",
                    },
                    "subject": {
                        "type": "string",
                        "description": "Email subject header.",
                    },
                    "body": {"type": "string", "description": "Email body content."},
                },
                "required": ["to_email", "subject", "body"],
            },
        },
    },
    # =====================================================================
    # 5. WORKSPACE, FILE & TERMINAL TOOLS
    # =====================================================================
    # Local tools
    {
        "type": "function",
        "function": {
            "name": "run_terminal_command",
            "description": "Run a shell command on the local machine workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The command to run"}
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_local_files",
            "description": "List, move, rename, write, append, read, delete, or open local files/folders inside the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": [
                            "list",
                            "move",
                            "rename",
                            "write",
                            "create",
                            "append",
                            "read",
                            "delete",
                            "open",
                        ],
                        "description": "The action to perform on files.",
                    },
                    "file_path": {
                        "type": "string",
                        "description": "Path of the file or directory relative to workspace.",
                    },
                    "destination": {
                        "type": "string",
                        "description": "Destination path if moving files.",
                    },
                    "new_name": {
                        "type": "string",
                        "description": "The new file name when action is set to 'rename'.",
                    },
                    "content": {
                        "type": "string",
                        "description": "The text content to write into the file when action is 'write' or 'create'.",
                    },
                },
                "required": ["action", "file_path"],
            },
        },
    },
    {"type": "function",
    "function": {
        "name": "native_macos_action",
        "description": "Fast-path (50ms) native execution for macOS desktop apps. Clicks buttons by label, triggers top menu bar items, or inspects UI elements without taking screenshots.",
        "parameters": {
            "type": "object",
            "properties": {
                "action_type": {
                    "type": "string",
                    "enum": ["click_element", "select_menu", "type_text", "inspect_ui"],
                    "description": "Type of native macOS UI interaction."
                },
                "app_name": {
                    "type": "string",
                    "description": "Name of the target macOS application (e.g., 'Finder', 'Slack', 'Xcode', 'System Settings')."
                },
                "element_type": {
                    "type": "string",
                    "description": "UI element class (e.g., 'button', 'checkbox', 'text field', 'pop up button'). Required for 'click_element'."
                },
                "target_label": {
                    "type": "string",
                    "description": "Exact text label of the button or menu item to click (e.g., 'Save', 'Run', 'General')."
                },
                "menu_name": {
                    "type": "string",
                    "description": "Top menu name (e.g., 'File', 'Edit', 'Product'). Required for 'select_menu'."
                },
                "text_to_type": {
                    "type": "string",
                    "description": "Text content to send. Required for 'type_text'."
                }
            },
            "required": ["action_type", "app_name"]
        }
    }
},
    ## for External Search
    {
        "type": "function",
        "function": {
            "name": "run_terminal_command",
            "description": "Run a terminal command safely inside the workspace directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to execute.",
                    }
                },
                "required": ["command"],
            },
        },
    },
    {
    "type": "function",
    "function": {
        "name": "synthesize_new_tool",
        "description": "Writes, tests, and registers a new Python tool script on the fly when no existing tool can accomplish a task.",
        "parameters": {
            "type": "object",
            "properties": {
                "tool_requirement": {
                    "type": "string",
                    "description": "Detailed specification of what the new tool should do (e.g. 'Fetch weather forecast using Open-Meteo API without an API key')."
                }
            },
            "required": ["tool_requirement"]
        }
    }
},
    # =====================================================================
    # 6. DESKTOP GUI & VISION TOOLS
    # =====================================================================
    ##GUI tool
    {
        "type": "function",
        "function": {
            "name": "handle_gui_action",
            "description": "Interact with desktop apps by moving the mouse, clicking, typing text, or pressing keyboard shortcuts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["click", "type", "press", "hotkey"],
                        "description": "The type of human-like interaction to perform.",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type or shortcut combination keys separated by '+' (e.g. 'ctrl+s').",
                    },
                    "x": {
                        "type": "integer",
                        "description": "Horizontal screen coordinate to click.",
                    },
                    "y": {
                        "type": "integer",
                        "description": "Vertical screen coordinate to click.",
                    },
                    "key": {
                        "type": "string",
                        "description": "Single key to press (e.g., 'enter', 'tab', 'escape').",
                    },
                },
                "required": ["action"],
            },
        },
    },
    # Take Screen shot
    {
        "type": "function",
        "function": {
            "name": "take_screenshot",
            "description": "Takes a screenshot of the current screen and saves it to the workspace so the AI can visually analyze desktop applications like Postman.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_element_coordinates",
            "description": "Analyzes the current active screen screenshot to find the exact X/Y physical pixel coordinates of a button, icon, or text field.",
            "parameters": {
                "type": "object",
                "properties": {
                    "element_description": {
                        "type": "string",
                        "description": "A very specific description of the element to find (e.g., 'The blue Login button in the top right', or 'The search bar next to the logo').",
                    }
                },
                "required": ["element_description"],
            },
        },
    },
    # =====================================================================
    # 7. AGENT SELF-IMPROVEMENT TOOLS
    # =====================================================================
    # skill Writer
    {
        "type": "function",
        "function": {
            "name": "save_new_skill",
            "description": "Saves a newly learned CLI tool, API usage, or automated workflow as a permanent Markdown skill in skills/. Call this whenever you execute a successful multi-step process for a tool you haven't mastered yet.",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {
                        "type": "string",
                        "description": "Short, clear name for the skill (e.g., 'docker', 'vercel_deploy', 'ffmpeg_conversion').",
                    },
                    "description": {
                        "type": "string",
                        "description": "Brief explanation of what this skill allows Jarvis to do.",
                    },
                    "rules_and_examples": {
                        "type": "string",
                        "description": "Detailed step-by-step CLI commands, flag explanations, syntax rules, and examples.",
                    },
                },
                "required": ["skill_name", "description", "rules_and_examples"],
            },
        },
    },
    # =====================================================================
    # 8. macOS SYSTEM CONTROL TOOLS
    # =====================================================================
    {
        "type": "function",
        "function": {
            "name": "set_volume",
            "description": "Adjusts macOS output volume level (0-100).",
            "parameters": {
                "type": "object",
                "properties": {
                    "level": {
                        "type": "integer",
                        "description": "Volume percentage from 0 to 100",
                    }
                },
                "required": ["level"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "launch_app",
            "description": "Opens or brings a macOS application to the front (e.g. 'Spotify', 'Finder', 'Slack').",
            "parameters": {
                "type": "object",
                "properties": {
                    "app_name": {
                        "type": "string",
                        "description": "Exact application name",
                    }
                },
                "required": ["app_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "revoke_task",
            "description": "Reverts or undoes a previously executed side-effecting task (e.g., deleting a written file, killing a running terminal command). Call this when the user asks to undo, revoke, or cancel a specific action.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "integer",
                        "description": "Optional specific task ID to revert.",
                    },
                    "tool_name": {
                        "type": "string",
                        "description": "Optional tool name to revert (e.g. 'manage_local_files').",
                    },
                },
            },
        },
    },
    # =====================================================================
    # 9. Browser tools
    # =====================================================================
    {
        "type": "function",
        "function": {
            "name": "execute_browser_automation",
            "description": "Dynamically navigate any website, interact with elements, and extract text. Use this to perform web operations when a specific tool doesn't exist.",
            "parameters": {
                "type": "object",
                "properties": {
                    "actions": {
                        "type": "array",
                        "description": "A sequential list of actions to perform in the browser.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": [
                                        "goto",
                                        "click",
                                        "type",
                                        "extract_text",
                                        "wait_for",
                                    ],
                                    "description": "The type of action to perform.",
                                },
                                "url": {
                                    "type": "string",
                                    "description": "Used with 'goto'. The URL to navigate to.",
                                },
                                "selector": {
                                    "type": "string",
                                    "description": "The CSS selector of the element (e.g., '#login-button', '.price-tag').",
                                },
                                "text": {
                                    "type": "string",
                                    "description": "Used with 'type'. The text to input into a field.",
                                },
                            },
                            "required": ["type"],
                        },
                    }
                },
                "required": ["actions"],
            },
        },
    },
]
