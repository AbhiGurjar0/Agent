import os
from types import SimpleNamespace
from dotenv import load_dotenv

load_dotenv()

config = SimpleNamespace(
    azure_openai_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    azure_openai_api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    azure_openai_api_version=os.getenv(
        "AZURE_OPENAI_API_VERSION",
        "2024-10-21",
    ),
    azure_openai_deployment=os.getenv("AZURE_OPENAI_DEPLOYMENT"),
    openai_api_key=os.getenv("OPENAI_API_KEY"),
    
)