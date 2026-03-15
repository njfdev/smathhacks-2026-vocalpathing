import numpy as np
import pyroomacoustics as pra
from scipy.optimize import minimize

# Define mic posiion in a array (x, y , z)
#Each row is one micropohone
#measurment in METERS
mic_positions = [
    [0,0,0] #mic 1
    [0,0,0] #mic 2
    [0,0,0] #mic 3
]#shape 3, 3

# 3 Audio Signals
if __name__ == "__main__":
    data = json.load(sys.stdin)
    mic1 = np.array(data["mic1"])
    mic2 = np.array(data["mic2"])
    mic3 = np.array(data["mic3"])

signals = np.stack([mic1, mic2, mic3])#shape (3, num samples)

SAMPLE_RATE = 10000
SPEED_OF_SOUND = 1480  # m/s underwater

def get_time_delay(signal1, signal2, sample_rate):
    #Cross corolate the 2 signals
    correlation = np.correlate(signal1, signal2, mode="full")
    #grab our max delay
    delay_samples = np.argmax(correlation)-(len(sig1) - 1)
    #convert samples to seconds
    return delay_samples / sample_rate

#use our time delay relitave to mic 1
delay_2_1 = get_time_delay(mic1, mic2, SAMPLE_RATE)
delay_3_1 = get_time_delay(mic1, mic3, SAMPLE_RATE)

time_delays = [delay_2_1, delay_3_1]

#use tdoa solver to get x,y,z cord
def tdoa_position(mic_positions, time_delays):
    mic_positions = mic_positions.T #back to shape 3,3 if it wasn't already

    #low key just a whole bunch of bs that finds error of distance precition by comparing predicted time delays to measured delays
    def residuals(source_pos):
        errors=[]
        ref = mic_positions[0]
        d_ref = np.linalg.norm(source_pos - ref)
        for i in range(1, len(mic_positions)):
            d_i = np.linalg.norm(source_pos - mic_positions[i])
            predicted_tdoa = (d_i - d_ref) / SPEED_OF_SOUND
            errors.append(predicted_tdoa - time_delays[i-1])
        return np.sum(np.array(errors)**2)
    
    #start predicion with mean position
    x0 = np.mean(mic_positions, axis=0)
    result = minimize(residuals, x0)
    return result.x #returns x,y,z but z is unreliable

#get positon and distance
source_xyz = tdoa_position(mic_positions, time_delays)




