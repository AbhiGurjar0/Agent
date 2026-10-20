from pydantic_settings import BaseSettings, SettingsConfigDict
import os 
class Settings(BaseSettings):
    APP_NAME: str = "My FastAPI App"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    MONGODB_URL: str =  "mongodb+srv://abhishekbainsla190:ZLwP98xzzTukNRsp@cluster0.4umua.mongodb.net/?appName=Cluster0"
    DATABASE_NAME:str="agents"

    JWT_SECRET_KEY: str="a_very_long_and_secure_secret_key_that_is_at_least_32_bytes_long"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    FRONTEND_URL: str = "http://localhost:5173"
    
    # YouTube API Credentials
    YOUTUBE_CLIENT_ID: str = ""
    YOUTUBE_CLIENT_SECRET: str = ""
    YOUTUBE_REFRESH_TOKEN: str = ""
    
    # Meta Graph API Credentials (Instagram & Facebook)
    META_ACCESS_TOKEN: str = ""
    INSTAGRAM_ACCOUNT_ID: str = ""
    FACEBOOK_PAGE_ID: str = ""

    # Email Config (SMTP or Gmail API)
    SMTP_SERVER: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SENDER_EMAIL: str = ""
    SENDER_PASSWORD: str = ""  # Google App Password
    
    # Web Seach 
    tavily_api_key: str = os.getenv("TAVILY_API_KEY", "")

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )
    


settings = Settings()



