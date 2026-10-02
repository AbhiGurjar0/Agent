import os
from google_auth_oauthlib.flow import InstalledAppFlow

# The YouTube upload scope required for agent actions
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
CLIENT_SECRETS_FILE = "client_secret.json"

def main():
    if not os.path.exists(CLIENT_SECRETS_FILE):
        print(f"Error: Could not find '{CLIENT_SECRETS_FILE}'.")
        print("Please download your OAuth client credentials from Google Cloud Console.")
        return

    # Create the flow using client secrets file
    flow = InstalledAppFlow.from_client_secrets_file(
        CLIENT_SECRETS_FILE, 
        scopes=SCOPES
    )

    # Force consent prompt to ensure a refresh token is returned
    print("Opening browser for authentication...")
    credentials = flow.run_local_server(
        port=0,
        prompt="consent",
        access_type="offline"
    )

    print("\n================ AUTHENTICATION SUCCESSFUL ================")
    print(f"Client ID:      {credentials.client_id}")
    print(f"Client Secret:  {credentials.client_secret}")
    print(f"Refresh Token:  {credentials.refresh_token}")
    print("===========================================================\n")
    
    print("Copy the Refresh Token, Client ID, and Client Secret into your .env file:")
    print(f"YOUTUBE_CLIENT_ID={credentials.client_id}")
    print(f"YOUTUBE_CLIENT_SECRET={credentials.client_secret}")
    print(f"YOUTUBE_REFRESH_TOKEN={credentials.refresh_token}")

if __name__ == "__main__":
    main()