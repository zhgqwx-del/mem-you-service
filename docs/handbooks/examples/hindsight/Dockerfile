# Build the fixed upstream source image first; see the deployment Handbook.
FROM hindsight-handbook-source:b92ceb1

# Seed a named Hugging Face cache volume with ownership matching upstream UID 1000.
USER root
RUN mkdir -p /home/hindsight/.cache/huggingface \
    && chown -R 1000:1000 /home/hindsight/.cache
USER hindsight
