# ============================================================
# CLINICAL ASSISTANT
# Backend RAG menggunakan:
# - FastAPI
# - FAISS
# - SentenceTransformer
# - Google GenAI SDK (gemini-2.5-flash)
# - Knowledge Base Kementerian Kesehatan RI
# ============================================================

import os
import pickle
import numpy as np
import faiss
from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from google import genai
from google.genai import errors

# ============================================================
# 1. LOAD ENVIRONMENT & INITIALIZE GEMINI
# ============================================================
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY belum ditemukan. Pastikan sudah dibuat di file .env")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)
# Model Gemini Terbaru
GEMINI_MODEL = "gemini-3.5-flash"

# ============================================================
# 2. LOAD FAISS INDEX & DOKUMEN
# ============================================================
VECTORSTORE_DIR = "vectorstore"
FAISS_PATH = os.path.join(VECTORSTORE_DIR, "index.faiss")
DATA_PATH = os.path.join(VECTORSTORE_DIR, "data.pkl")
MODEL_INFO_PATH = os.path.join(VECTORSTORE_DIR, "model_info.pkl")

print("🔄 Memuat FAISS index & metadata...")
index = faiss.read_index(FAISS_PATH)

with open(DATA_PATH, "rb") as f:
    data = pickle.load(f)

with open(MODEL_INFO_PATH, "rb") as f:
    model_info = pickle.load(f)

print(f"✅ FAISS & Data Dokumen Berhasil Dimuat ({index.ntotal} vector)")
print(f"📌 Embedding Model: {model_info['embedding_model']} (Dimensi: {model_info['dimension']})")

# Load SentenceTransformer
print("🔄 Memuat SentenceTransformer...")
embedding_model = SentenceTransformer(model_info["embedding_model"], device="cpu")
print("✅ Embedding model berhasil dimuat.")

# ============================================================
# 3. FASTAPI SETUP
# ============================================================
app = FastAPI(
    title="Clinical Assistant API",
    description="Backend Clinical Assistant berbasis RAG dengan Knowledge Base Pedoman Kementerian Kesehatan RI.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# 4. PYDANTIC SCHEMAS (DISESUAIKAN DENGAN FRONTEND)
# ============================================================
class ChatRequest(BaseModel):
    question: str
    top_k: int = 5

class Source(BaseModel):
    source: str
    title: str | None = None
    page: int | str | None = None
    score: float
    url: str | None = None

class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]

# ============================================================
# 5. RETRIEVAL FUNCTION
# ============================================================
def retrieve(question: str, top_k: int = 5):
    top_k = max(1, min(top_k, 20))

    # Query Embedding
    query_embedding = embedding_model.encode(
        [question],
        convert_to_numpy=True,
        normalize_embeddings=True
    )
    query_embedding = np.asarray(query_embedding, dtype="float32")

    # FAISS Search
    scores, indices = index.search(query_embedding, top_k)

    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx == -1:
            continue
        
        idx = int(idx)
        doc_id, text, metadata = data[idx]

        results.append({
            "id": str(doc_id),
            "score": float(score),
            "text": text,
            "metadata": metadata
        })

    return results

def build_context(results):
    context_parts = []
    for i, result in enumerate(results, 1):
        metadata = result["metadata"]
        source = metadata.get("source", "Tidak diketahui")
        page = metadata.get("page", "Tidak diketahui")
        text = result["text"]

        context_parts.append(
            f"--- CONTEXT {i} ---\n"
            f"Source: {source}\n"
            f"Page: {page}\n"
            f"Score: {result['score']:.4f}\n"
            f"Text: {text}\n"
        )
    return "\n".join(context_parts)

# ============================================================
# PROMPT RAG OJK - FORMAT JAWABAN
# ============================================================
def build_prompt(query, context):
    prompt = f"""
Anda adalah OJK Regulatory AI Assistant, sebuah sistem AI untuk membantu
analisis dan pencarian informasi berdasarkan dokumen regulasi Otoritas Jasa
Keuangan (OJK).

Gunakan HANYA informasi yang terdapat dalam konteks berikut:

{context}

Pertanyaan:
{query}

INSTRUKSI JAWABAN:
1. Jawab langsung dan jelas sesuai pertanyaan.
2. Gunakan bahasa Indonesia yang formal dan mudah dipahami.
3. Jangan menggunakan informasi di luar konteks.
4. Jangan mengarang nomor pasal, ayat, halaman, atau ketentuan.
5. Jika informasi tidak ditemukan dalam konteks, katakan bahwa informasi
   tersebut tidak ditemukan dalam dokumen yang tersedia.
6. Jangan menggunakan format Markdown seperti **bold**, *, #, atau ``` .
7. Gunakan paragraf biasa atau bullet point sederhana jika diperlukan.
8. Cantumkan sumber dokumen dan halaman berdasarkan metadata yang tersedia.

Pertanyaan:
{query}
"""
    return prompt

def generate_answer(question, context):
    prompt = build_prompt(question, context)
    
    try:
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt
        )
        return response.text
    except errors.APIError as e:
        print(f"❌ Gemini API Error: {e}")
        return "<p>Terjadi kesalahan teknis saat menghubungi layanan Gemini AI.</p>"
    except Exception as e:
        print(f"❌ Unexpected Error: {e}")
        return "<p>Terjadi kesalahan sistem dalam memproses jawaban.</p>"

# ============================================================
# 7. ENDPOINTS
# ============================================================
@app.get("/")
def root():
    return {
        "status": "online",
        "application": "Clinical Assistant API",
        "llm": GEMINI_MODEL,
        "embedding": model_info["embedding_model"],
        "vector_database": "FAISS",
        "total_vectors": index.ntotal
    }

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "faiss_ready": index.is_trained,
        "total_documents": len(data)
    }

@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    question = request.question.strip()

    if not question:
        return {
            "answer": "<p>Silakan masukkan pertanyaan klinis Anda.</p>",
            "sources": []
        }

    # 1. Retrieval
    results = retrieve(question, request.top_k)

    if not results:
        return {
            "answer": "<p>Informasi tersebut tidak ditemukan dalam Knowledge Base Kementerian Kesehatan RI.</p>",
            "sources": []
        }

    # 2. Build Context & Generate LLM Answer
    context = build_context(results)
    answer = generate_answer(question, context)

    # 3. Format Sources untuk Frontend
    sources = []
    for result in results:
        metadata = result["metadata"]
        sources.append({
            "source": metadata.get("source", "Dokumen Kemenkes RI"),
            "title": metadata.get("title", metadata.get("source", "Pedoman Klinis")),
            "page": metadata.get("page"),
            "score": round(result["score"], 4),
            "url": metadata.get("url")  # Tautan ke PDF jika ada di metadata
        })

    return {
        "answer": answer,
        "sources": sources
    }

# ============================================================
# 8. MAIN EXECUTION
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
    

# OMP_NUM_THREADS=1 \
# MKL_NUM_THREADS=1 \
# OPENBLAS_NUM_THREADS=1 \
# VECLIB_MAXIMUM_THREADS=1 \
# uvicorn app:app --workers 1