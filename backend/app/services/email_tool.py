import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import settings

async def send_email_message(to_email: str, subject: str, body: str) -> dict:
    """
    Sends an email using standard SMTP (configured for Gmail or custom SMTP server).
    """
    if not settings.SENDER_EMAIL or not settings.SENDER_PASSWORD:
        return {"status": "error", "message": "Email credentials missing in .env"}

    try:
        msg = MIMEMultipart()
        msg["From"] = settings.SENDER_EMAIL
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        # Connect via SMTP TLS
        server = smtplib.SMTP(settings.SMTP_SERVER, settings.SMTP_PORT)
        server.starttls()
        server.login(settings.SENDER_EMAIL, settings.SENDER_PASSWORD)
        server.send_message(msg)
        server.quit()

        return {"status": "success", "message": f"Email sent successfully to {to_email}!"}
    except Exception as e:
        return {"status": "error", "message": f"Failed to send email: {str(e)}"}