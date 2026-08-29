import modal
from modal_app import image
app = modal.App("genome-vers")
@app.function(image=image)
def show():
    import importlib.metadata as md
    for p in ["transformers", "torch", "librosa", "soundfile", "demucs", "numpy", "muq", "edm98"]:
        try:
            print(p, md.version(p))
        except Exception as e:
            print(p, "?", e)
    import transformers, inspect, os
    mu = os.path.join(os.path.dirname(transformers.__file__), "masking_utils.py")
    print("masking_utils exists:", os.path.exists(mu))
