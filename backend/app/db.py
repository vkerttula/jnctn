import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGODB_DB", "jnctn")

client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=2000)
db = client[DB_NAME]
