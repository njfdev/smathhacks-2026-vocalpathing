import torch
import soundfile as sf
from asteroid.models import BaseModel

# Asteroid's from_pretrained doesn't forward kwargs to torch.load,
# so we temporarily patch it to allow loading numpy-containing checkpoints.
_original_load = torch.load
torch.load = lambda *a, **kw: _original_load(*a, **{**kw, "weights_only": False})
model = BaseModel.from_pretrained("mpariente/DPRNNTasNet-ks2_WHAM_sepclean")
torch.load = _original_load

# Or simply a file name:
separated = model.separate("./test_recordings/talking_while_tapping.m4a")

# Save separated sources
for i in range(separated.shape[1]):
    sf.write(
        f"./test_recordings/sources/source_{i}.wav",
        separated[0, i].detach().numpy(),
        8000,
    )
