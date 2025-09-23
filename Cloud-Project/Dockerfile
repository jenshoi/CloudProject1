FROM node:20-bullseye

# Systemavhengigheter
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node-deps inne i container (robust på Linux/ARM/x86)
COPY package*.json ./
RUN npm install --omit=dev


# Kopier resten av koden
COPY . .

# Python-deps (robust på x86_64 og aarch64)
ENV PIP_NO_CACHE_DIR=1
RUN python3 -m pip install --upgrade pip wheel setuptools && \
    # PyTorch CPU-hjul fra offisielt repo (fungerer på x86_64 og aarch64)
    pip3 install --index-url https://download.pytorch.org/whl/cpu \
        torch torchvision && \
    # Ultralytics + OpenCV HEADLESS + numpy
    pip3 install ultralytics==8.* opencv-python-headless numpy

# Sørg for mapper
RUN mkdir -p uploads outputs

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "app.js"]


#Debugging for Ørjan
COPY package*.json ./
RUN ls -l /app
RUN cat package.json
RUN npm install --omit=dev





