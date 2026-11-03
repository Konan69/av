# Analyzer models

The analyzer downloads these models into a Modal Volume when you run
`modal run modal_app.py::download_weights`. None of them ship in this
repository. Check each license before you deploy, in particular before any
commercial use.

| Model | Source | License |
| --- | --- | --- |
| EDMFormer section head | https://github.com/25ohms/EDM-98 (`data/checkpoints/model.pt`, `msd_stats.json`) | CC BY 4.0 (attribution required) |
| MusicFM backbone | https://huggingface.co/minzwon/MusicFM (`pretrained_msd.pt`), code https://github.com/minzwon/musicfm | MIT (code also MIT, one file Apache-2.0) |
| MuQ embeddings | https://huggingface.co/OpenMuQ/MuQ-large-msd-iter, code https://github.com/tencent-ailab/MuQ | weights CC BY-NC 4.0 (non-commercial); code MIT |
| Beat This! | https://github.com/CPJKU/beat_this | MIT (code and published weights) |
| HTDemucs 6-stem (`htdemucs_6s`) | https://github.com/facebookresearch/demucs | MIT |

The MuQ weights are non-commercial. A deployment of this analyzer inherits
that restriction.
