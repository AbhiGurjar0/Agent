tools = [
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
                    "video_url": {"type": "string", "description": "Public HTTP URL of the video file."},
                    "caption": {"type": "string", "description": "Caption and hashtags for the Reel."}
                },
                "required": ["video_url", "caption"]
            }
        }
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
                    "file_path_or_url": {"type": "string", "description": "Local file path or video URL."},
                    "title": {"type": "string", "description": "Facebook post title."},
                    "description": {"type": "string", "description": "Facebook video post description."}
                },
                "required": ["file_path_or_url", "title", "description"]
            }
        }
    },
    # Email Tool
    {
        "type": "function",
        "function": {
            "name": "send_email_message",
            "description": "Send an email message to a recipient.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to_email": {"type": "string", "description": "Recipient email address."},
                    "subject": {"type": "string", "description": "Email subject header."},
                    "body": {"type": "string", "description": "Email body content."}
                },
                "required": ["to_email", "subject", "body"]
            }
        }
    }
]
