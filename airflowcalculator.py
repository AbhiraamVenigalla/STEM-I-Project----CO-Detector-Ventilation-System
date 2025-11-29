from scipy.optimize import curve_fit
import numpy as np
from enum import Enum
import math

class AirFlowInhibitorWeights(Enum):
    FURNITURE = 3
    NUM_FANS = 2
    RESIDENTIAL_CFM = 15

class Constants(Enum):
    NUM_FURNITURE = 6
    INDOOR_VENT_SPEED = 0.5
    PEOPLE = 4

class AirFlowCalculator:
    def __init__(self, room_volume_m3):
        self.room_volume = room_volume_m3
        self.CO_history = []

    def add_measurement(self, timestamp, CO_ppm):
        self.CO_history.append((timestamp, CO_ppm))

    def calculate_airflow(self):
        print(f"[DEBUG] CO_history has {len(self.CO_history)} measurements")

        if len(self.CO_history) < 2:
            print("[DEBUG] Not enough data (need at least 2 measurements)")
            return None

        recent_data = self.CO_history[-10:]
        print(f"[DEBUG] Using last {len(recent_data)} measurements")

        times = np.array([t for t, _ in recent_data])
        CO_vals = np.array([co for _, co in recent_data])

        print(f"[DEBUG] Times: {times}")
        print(f"[DEBUG] CO values: {CO_vals}")

        # Check if CO is decaying
        if CO_vals[0] <= CO_vals[-1]:
            print("[DEBUG] CO not decaying (rising or stable), cannot calculate")
            return None

        try:
            def decay(t, C0, lambd):
                return C0 * np.exp(-lambd * (t - times[0]))

            # Fit exponential decay
            params, covariance = curve_fit(decay, times, CO_vals, p0=[CO_vals[0], 0.001])
            C0_fit, lambda_per_sec = params

            print(f"[DEBUG] Fitted C0: {C0_fit:.1f}, lambda: {lambda_per_sec:.6f}")

            # Calculate ACH and airflow
            ACH = lambda_per_sec * 3600  
            airflow_m3h = ACH * self.room_volume
            airflow_CFM = airflow_m3h * 0.588

            print(f"[DEBUG] ACH: {ACH:.2f}, Airflow: {airflow_m3h:.1f} m³/h ({airflow_CFM:.1f} CFM)")

            def sigmoid(x):
              return 1 / (1 + (math.e ** -x))

            # Quantify confidence levels i
            def quant_confidence(confidence, num_furniture, indoor_vent_speed, current_capacity):
                count = 50
                if confidence == "low":
                    count -= 25
                else:
                    count += 25

                add_factors = (num_furniture * AirFlowInhibitorWeights.FURNITURE.value +
                               indoor_vent_speed * AirFlowInhibitorWeights.NUM_FANS.value +
                               current_capacity * AirFlowInhibitorWeights.RESIDENTIAL_CFM.value)
                cp_value = (count + add_factors)
                cp_value = sigmoid(cp_value) # normalize confidence between 0 and 1 using sigmoidal curve
                return round(cp_value, 2)

            bin_cval = "high" if len(recent_data) >= 5 else "low"

            result = {
                "ACH": ACH,
                'airflow_m3h': airflow_m3h,
                'airflow_CFM': airflow_CFM,
                'confidence': quant_confidence(bin_cval,
                                               Constants.NUM_FURNITURE.value,
                                               Constants.INDOOR_VENT_SPEED.value,
                                               Constants.PEOPLE.value)
            }

            print(f"[DEBUG] Returning result: {result}")
            return result

        except Exception as e:
            print(f"[ERROR] Curve fitting failed: {e}")
            import traceback
            traceback.print_exc()
            return None


# Implementation
if __name__ == "__main__":
    print("=== Testing AirFlowCalculator ===\n")

    room = AirFlowCalculator(room_volume_m3=48)  # 5m × 4m × 2.4m room

    # use dummy data
    print("Adding measurements...")
    room.add_measurement(timestamp=0, CO_ppm=400)
    room.add_measurement(timestamp=30, CO_ppm=380)
    room.add_measurement(timestamp=60, CO_ppm=362)
    room.add_measurement(timestamp=90, CO_ppm=345)
    room.add_measurement(timestamp=120, CO_ppm=328)
    room.add_measurement(timestamp=150, CO_ppm=313)

    print("\nCalculating airflow...")
    result = room.calculate_airflow()

    if result:
        print("\n=== RESULTS ===")
        print(f"Air Exchange Rate: {result['ACH']:.2f} ACH")
        print(f"Airflow: {result['airflow_m3h']:.1f} m³/h ({result['airflow_CFM']:.1f} CFM)")
        print(f"Confidence: {result['confidence']}")
    else:
        print("\n No result returned")
