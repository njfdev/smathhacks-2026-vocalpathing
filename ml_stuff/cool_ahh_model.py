import tensorflow_hub as hub
import tensorflow as tf
import numpy as np
import torch
import librosa


#Basically loading in permamnt .eval or .no_grad. Just a frozen model
model = hub.load('https://www.kaggle.com/models/google/multispecies-whale/TensorFlow2/default/2')

#---------Input-----------
"""
Raw waveform float array
Sample rate: 10,000 Hz
Window size: 5 seconds
Shape: (batch, 50000)  ← 5 seconds * 10,000 samples
"""
#-------------------------

#load audio file
waveform, _ = librosa.load('your_audio.wav', sr=10000, mono=True) #automatiaclly scales to 10,000 hz audio and one channel

window_size = 50000 # 5 sec of 10,000 hz audio

#chunk audio into the 5 sec windows
chunks = []
for i in range(0, len(waveform) - window_size, window_size):
    chunk = waveform[i : i + window_size]  # grab 50,000 samples
    chunks.append(chunk)

batch=np.stack(chunks)#list of arrays into a 2d array
audio=tf.constant(batch, dtype=tf.float32) #from np array to tensor

#Run infrence
@tf.function
def get_embeddings(audio):
    return model(audio)

outputs = get_embeddings(audio) #outputs is a dict of [embeddings and scores]
outputs["scores"] = torch.sigmoid(torch.from_numpy(outputs["scores"].numpy())) #change to pytorch tensor and change to 0-1 probabalites

class_idx = torch.argmax(outputs["scores"], dim=1) #Max probaality is predicion

#class mappings from google
CLASS_NAMES = [
    'humpback_song',
    'humpback_call', 
    'orca_call',
    'orca_echolocation',
    'blue_whale',
    'fin_whale',
    'minke_whale',
    'brydes_whale_biotwang',
    'brydes_whale_call',
    'narw_upcall',
    'narw_gunshot',
    'nprw'
]

#mapping our class index to the class names for each chunk and leaving them in all_class_predicitions
all_class_predicions = []
for i, idx in enumerate(class_idx):
    chunk_class = [CLASS_NAMES[idx.item()]]
    all_class_predicions.append(chunk_class)

#changing to set type
print("Unique classes detected:", set(all_class_predicions))