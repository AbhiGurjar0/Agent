import base64
from typing import Optional
from pydantic import BaseModel
from openai import AsyncOpenAI
import os

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# 1. Define the Structured Output Schema
class ElementCoordinates(BaseModel):
    found: bool
    reasoning: str
    x_center: Optional[int]
    y_center: Optional[int]

def encode_image(image_path: str):
    """Encodes the screenshot to Base64."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

async def find_element_on_screen(image_path: str, element_description: str) -> dict:
    """
    Sends a screenshot to GPT-4o and asks for the X/Y coordinates of a specific element.
    Returns the physical X/Y pixel coordinates.
    """
    base64_image = encode_image(image_path)
    
    # Critical Prompting Strategy: Tell the model to act as an object detection system
    prompt = f"""
    You are an exact GUI object detection system. 
    Analyze this screenshot and locate the following element: "{element_description}".
    
    If the element is found, return its exact X and Y pixel coordinates from the top-left corner of the image. 
    Aim for the direct center of the interactive element (the part a user would click).
    If it cannot be found, set found to false.
    """

    try:
        # Use GPT-4o for high-accuracy vision
        response = await client.beta.chat.completions.parse(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}",
                                "detail": "high"  # High detail is required for reading UI text
                            }
                        }
                    ]
                }
            ],
            response_format=ElementCoordinates,
            max_tokens=300
        )
        
        parsed_result = response.choices[0].message.parsed
        
        if parsed_result.found:
            return {
                "status": "success", 
                "x": parsed_result.x_center, 
                "y": parsed_result.y_center,
                "reasoning": parsed_result.reasoning
            }
        else:
            return {
                "status": "not_found",
                "error": f"Could not find '{element_description}' on screen. Reasoning: {parsed_result.reasoning}"
            }

    except Exception as e:
        return {"status": "error", "error": str(e)}