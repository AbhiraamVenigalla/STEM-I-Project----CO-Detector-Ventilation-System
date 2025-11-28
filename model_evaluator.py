import pandas as pd
from pandas import DataFrame as df
import numpy as np
import matplotlib as plt
import tabulate
from sklearn.preprocessing import MinMaxScaler
from statsmodels.tsa.arima.model import ARIMA
import sys
import time
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from abc import ABC, abstractmethod
from enum import Enum
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import GRU, LSTM, Dense, Dropout
import sys

# function to read .csv file and graph cleaned version of data (without NaN or non-positive values)
def graph_and_display(file_path):
  data_input = pd.read_csv(file_path)
  print(tabulate.tabulate(data.head(20), headers="keys", tablefmt="psql"))

  data['Pressure(hPa)'] = pd.to_numeric(data['Pressure(hPa)'], errors='coerce')
  data['Humidity(%)'] = pd.to_numeric(data['Humidity(%)'], errors='coerce')
  data['Temperature(C)'] = pd.to_numeric(data['Temperature(C)'], errors='coerce')
  data['CO_PPM'] = pd.to_numeric(data['CO_PPM'], errors='coerce')

  # filter nan and negative values
  data_clean = data[(data['Pressure(hPa)'] > 0) &
                    (data['Humidity(%)'] > 0) &
                    (data['Temperature(C)'] > 0)]

  # plot cleaned data
  plt.figure(figsize=(12, 6))
  plt.plot(data_clean['CO_PPM'], label='CO_PPM', color='red')
  plt.plot(data_clean['Temperature(C)'], label='Temperature (C)', color='orange')
  plt.plot(data_clean['Humidity(%)'], label='Humidity (%)', color='blue')
  plt.plot(data_clean['Pressure(hPa)'], label='Pressure (hPa)', color='green')

  plt.xlabel('Sample Index / Time (Each measurement was taken every 2 seconds)')
  plt.ylabel('Value')
  plt.title('Sensor Readings Over Time (CLEANED) for NON-DEAD ZONES')
  plt.legend()
  plt.grid(True)
  plt.show()


# function to make time-series data 
def prepare_timeseries_data(df, target_column, lookback=20, train_split=0.8, val_split=0.1,
                            feature_columns=None, scale=True):
    """
    lookback: amount of data-points model looks back at to make prediction
    train_split: amount of data split for training purposes only
    val_split: amount of data split for validation only (rest is for testing)

    Uses 80-10-10 (train-test-val) split

    target_column: data point you want to forecast
    feature_columns: str array of features that model uses to predict target_column

    scale: boolean to decide whether min-max scaling is needed or not
    
    """

    if feature_columns is None:
        feature_columns = df.select_dtypes(include=[np.number]).columns.tolist()

    if target_column not in feature_columns:
        feature_columns.append(target_column)

    data = df[feature_columns].values

    scaler = None
    if scale:
        scaler = MinMaxScaler()
        data = scaler.fit_transform(data)

    X, y = create_sequences(data, lookback, feature_columns.index(target_column))

    n_samples = len(X)
    train_end = int(n_samples * train_split)
    val_end = int(n_samples * (train_split + val_split))

    X_train = X[:train_end]
    y_train = y[:train_end]

    X_val = X[train_end:val_end]
    y_val = y[train_end:val_end]

    X_test = X[val_end:]
    y_test = y[val_end:]

    print("=" * 60)
    print("DATA PREPARATION SUMMARY")
    print("=" * 60)
    print(f"Total samples: {n_samples}")
    print(f"Features: {feature_columns}")
    print(f"Target: {target_column}")
    print(f"Lookback: {lookback}")
    print(f"\nTrain set: {len(X_train)} samples ({train_split*100:.0f}%)")
    print(f"Val set:   {len(X_val)} samples ({val_split*100:.0f}%)")
    print(f"Test set:  {len(X_test)} samples ({(1-train_split-val_split)*100:.0f}%)")
    print(f"\nX shape: {X_train.shape}")
    print(f"y shape: {y_train.shape}")
    print("=" * 60)

    return X_train, y_train, X_val, y_val, X_test, y_test, scaler


def create_sequences(data, lookback, target_idx):
    X, y = [], []

    for i in range(lookback, len(data)):
        X.append(data[i-lookback:i])
        y.append(data[i, target_idx])

    return np.array(X), np.array(y)


def simple_split(df, target_column, train_pct=0.8, val_pct=0.1, feature_columns=None):

    if feature_columns is None:
        feature_columns = [col for col in df.columns if col != target_column]

    X = df[feature_columns].values
    y = df[target_column].values

    n = len(X)
    train_end = int(n * train_pct)
    val_end = int(n * (train_pct + val_pct))

    X_train = X[:train_end]
    y_train = y[:train_end]

    X_val = X[train_end:val_end]
    y_val = y[train_end:val_end]

    X_test = X[val_end:]
    y_test = y[val_end:]

    print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")

    return X_train, y_train, X_val, y_val, X_test, y_test

# make data divisions
X_train, y_train, X_val, y_val, X_test, y_test, scaler = prepare_timeseries_data(
    data_clean,
    target_column = "CO_PPM",
    feature_columns = ["Temperature(C)", "Pressure(hPa)", "Humidity(%)"]
)



class TimeSeriesModel(ABC):
    """Base class for all time series models"""

    def __init__(self, name):
        self.name = name
        self.model = None
        self.training_time = 0
        self.prediction_time = 0
        self.model_size = 0
        self.metrics = {}

    @abstractmethod
    def train(self, X_train, y_train):
        pass

    @abstractmethod
    def predict(self, X_test):
        pass

    def evaluate(self, X_train, y_train, X_test, y_test):
        start = time.time()
        self.train(X_train, y_train)
        self.training_time = time.time() - start

        start = time.time()
        y_pred = self.predict(X_test)
        self.prediction_time = time.time() - start

        self.metrics = {
            'MSE': mean_squared_error(y_test, y_pred),
            'RMSE': np.sqrt(mean_squared_error(y_test, y_pred)),
            'MAE': mean_absolute_error(y_test, y_pred),
            'R2': r2_score(y_test, y_pred),
            'MAPE': np.mean(np.abs((y_test - y_pred) / y_test)) * 100
        }

        return y_pred

    def get_summary(self):
        return {
            'Model': self.name,
            'Training Time (s)': round(self.training_time, 4),
            'Prediction Time (s)': round(self.prediction_time, 4),
            'Model Size (KB)': round(self.model_size / 1024, 2),
            **{k: round(v, 4) for k, v in self.metrics.items()}
        }


# ========================================================================================================================

# Classes for each time-series forecasting model used in preliminary testing

"""
LOM: Last observed model is the base control model, which just outputs the previous value as the approximated 
forecasted value
"""
class LastObservedModel(TimeSeriesModel):

    def __init__(self):
        super().__init__("Last Observed (Control)")

    def train(self, X_train, y_train):
        self.model_size = 0

    def predict(self, X_test):
        if len(X_test.shape) == 2:
            return X_test[:, -1]
        else:
            return X_test[:, -1, 0]

"""
LSTM: Uses 4-gate system to actively remember important information while disregarding noise in the data for effecient 
time-series forecasting. This test uses a standard LSTM-2xDroupout-Dense layer system with 50 units, 50 epochs, and these
conditions are replicated for each model ensuring no differences during testing.
"""
class LSTMModel(TimeSeriesModel):

    def __init__(self, units=50, epochs=50, batch_size=32):
        super().__init__(f"LSTM (units={units})")
        self.units = units
        self.epochs = epochs
        self.batch_size = batch_size

    def train(self, X_train, y_train):
      
        self.model = Sequential([
            LSTM(self.units, return_sequences=True, input_shape=(X_train.shape[1], X_train.shape[2])),
            Dropout(0.2),
            LSTM(self.units // 2),
            Dropout(0.2),
            Dense(1)
        ])

        self.model.compile(optimizer='adam', loss='mse')
        self.model.fit(X_train, y_train, epochs=self.epochs, batch_size=self.batch_size,
                       verbose=0, validation_split=0.1)

        self.model_size = self.model.count_params() * 4

    def predict(self, X_test):
        return self.model.predict(X_test, verbose=0).flatten()

"""
ARIMA: Math model used for time-series forecasting. Use pre-trained ARIMA model but adjust conditions to eliminate differences
in whether it is already trained or not
"""
class ARIMAModel(TimeSeriesModel):

    def __init__(self, order=(5,1,0)):
        super().__init__(f"ARIMA{order}")
        self.order = order

    def train(self, X_train, y_train):
        if len(X_train.shape) > 1:
            train_data = np.concatenate([X_train.flatten(), y_train])
        else:
            train_data = np.concatenate([X_train, y_train])

      # model definition
        self.model = ARIMA(train_data, order=self.order)
        self.fitted_model = self.model.fit()
        self.model_size = sys.getsizeof(self.fitted_model.params) * 2

    def predict(self, X_test):
        n_steps = len(X_test)
        forecast = self.fitted_model.forecast(steps=n_steps)
        return forecast

"""
GRU model. Like LSTM, but takes up less space and has faster training time. Follow same structure as LSTM since it is also a deep
learning neural network
"""

class GRUModel(TimeSeriesModel):

    def __init__(self, units=50, epochs=50, batch_size=32):
        super().__init__(f"GRU (units={units})")
        self.units = units
        self.epochs = epochs
        self.batch_size = batch_size

    def train(self, X_train, y_train):
        

      # model definition
        self.model = Sequential([
            GRU(self.units, return_sequences=True, input_shape=(X_train.shape[1], X_train.shape[2])),
            Dropout(0.2),
            GRU(self.units // 2),
            Dropout(0.2),
            Dense(1)
        ])

        self.model.compile(optimizer='adam', loss='mse')
        self.model.fit(X_train, y_train, epochs=self.epochs, batch_size=self.batch_size,
                       verbose=0, validation_split=0.1)

        self.model_size = self.model.count_params() * 4

    def predict(self, X_test):
        return self.model.predict(X_test, verbose=0).flatten()


class RandomForestModel(TimeSeriesModel):

    def __init__(self, n_estimators=100):
        super().__init__(f"Random Forest (n={n_estimators})")
        self.n_estimators = n_estimators

    def train(self, X_train, y_train):
        from sklearn.ensemble import RandomForestRegressor
        import sys

        if len(X_train.shape) == 3:
            X_train = X_train.reshape(X_train.shape[0], -1)

        self.model = RandomForestRegressor(n_estimators=self.n_estimators, random_state=42)
        self.model.fit(X_train, y_train)
        self.model_size = sys.getsizeof(self.model) * 2

    def predict(self, X_test):
        if len(X_test.shape) == 3:
            X_test = X_test.reshape(X_test.shape[0], -1)
        return self.model.predict(X_test)


class XGBoostModel(TimeSeriesModel):

    def __init__(self, n_estimators=100):
        super().__init__(f"XGBoost (n={n_estimators})")
        self.n_estimators = n_estimators

    def train(self, X_train, y_train):
        from xgboost import XGBRegressor
        import sys

        if len(X_train.shape) == 3:
            X_train = X_train.reshape(X_train.shape[0], -1)

        self.model = XGBRegressor(n_estimators=self.n_estimators, random_state=42, verbosity=0)
        self.model.fit(X_train, y_train)
        self.model_size = sys.getsizeof(self.model) * 2

    def predict(self, X_test):
        if len(X_test.shape) == 3:
            X_test = X_test.reshape(X_test.shape[0], -1)
        return self.model.predict(X_test)

# enum that switches between model type for easy training and testing
class ModelType(Enum):
    LAST_OBSERVED = 0
    LSTM = 1
    GRU = 2
    ARIMA = 3
    RANDOM_FOREST = 4
    XGBOOST = 5


def get_model(model_type, **kwargs):
    if isinstance(model_type, int):
        model_type = ModelType(model_type)

    if model_type == ModelType.LAST_OBSERVED:
        return LastObservedModel()
    elif model_type == ModelType.LSTM:
        units = kwargs.get('units', 50)
        epochs = kwargs.get('epochs', 50)
        batch_size = kwargs.get('batch_size', 32)
        return LSTMModel(units, epochs, batch_size)
    elif model_type == ModelType.GRU:
        units = kwargs.get('units', 50)
        epochs = kwargs.get('epochs', 50)
        batch_size = kwargs.get('batch_size', 32)
        return GRUModel(units, epochs, batch_size)
    elif model_type == ModelType.ARIMA:
        order = kwargs.get('order', (5, 1, 0))
        return ARIMAModel(order)
    elif model_type == ModelType.RANDOM_FOREST:
        n_estimators = kwargs.get('n_estimators', 100)
        return RandomForestModel(n_estimators)
    elif model_type == ModelType.XGBOOST:
        n_estimators = kwargs.get('n_estimators', 100)
        return XGBoostModel(n_estimators)
    else:
        raise ValueError(f"Unknown model type: {model_type}")


def quick_train(model_number, X_train, y_train, X_test, y_test, **kwargs):
    print(f"\n{'='*60}")
    print(f"Training Model #{model_number}: {ModelType(model_number).name}")
    print(f"{'='*60}")

    model = get_model(model_number, **kwargs)
    y_pred = model.evaluate(X_train, y_train, X_test, y_test)

    print(f"\n✓ Training completed in {model.training_time:.4f}s")
    print(f"✓ RMSE: {model.metrics['RMSE']:.4f}")
    print(f"✓ MAE: {model.metrics['MAE']:.4f}")
    print(f"✓ R²: {model.metrics['R2']:.4f}")
    print(f"✓ Model size: {model.model_size/1024:.2f} KB")

    return model, y_pred


class ModelComparator:

    def __init__(self):
        self.models = []
        self.results = []

    def add_model(self, model):
        self.models.append(model)

    def compare(self, X_train, y_train, X_test, y_test):
        print("=" * 80)
        print("TRAINING AND EVALUATING MODELS")
        print("=" * 80)

        for model in self.models:
            print(f"\n[{model.name}]")
            try:
                model.evaluate(X_train, y_train, X_test, y_test)
                self.results.append(model.get_summary())
                print(f"✓ Training time: {model.training_time:.4f}s")
                print(f"✓ RMSE: {model.metrics['RMSE']:.4f}")
            except Exception as e:
                print(f"✗ Error: {e}")

        self.results_df = pd.DataFrame(self.results)
        return self.results_df

    def plot_comparison(self):
        if not self.results:
            print("No results to plot. Run compare() first.")
            return

        fig, axes = plt.subplots(2, 3, figsize=(16, 10))
        fig.suptitle('Model Comparison Dashboard', fontsize=16, fontweight='bold')

        metrics = ['RMSE', 'MAE', 'R2', 'Training Time (s)', 'Model Size (KB)', 'MAPE']

        for idx, (ax, metric) in enumerate(zip(axes.flat, metrics)):
            data = self.results_df.sort_values(metric, ascending=(metric != 'R2'))
            colors = ['green' if i == 0 else 'orange' if i == 1 else 'red'
                     for i in range(len(data))]

            ax.barh(data['Model'], data[metric], color=colors, alpha=0.7)
            ax.set_xlabel(metric, fontweight='bold')
            ax.set_title(f'{metric} Comparison', fontweight='bold')
            ax.grid(axis='x', alpha=0.3)

        plt.tight_layout()
        plt.show()

    def get_best_model(self, metric='RMSE'):
        ascending = (metric != 'R2')
        best = self.results_df.sort_values(metric, ascending=ascending).iloc[0]
        return best['Model'], best[metric]

    def get_best_model_weighted(self, weights=None):
        if weights is None:
            weights = {
                'RMSE': 0.35,
                'MAE': 0.25,
                'Training Time (s)': 0.15,
                'Model Size (KB)': 0.15,
                'R2': 0.10
            }

        total_weight = sum(weights.values())
        if abs(total_weight - 1.0) > 0.01:
            raise ValueError(f"Weights must sum to 1.0, got {total_weight}")

        available_metrics = set(self.results_df.columns) - {'Model'}
        for metric in weights.keys():
            if metric not in available_metrics:
                raise ValueError(f"Metric '{metric}' not found in results")

        df = self.results_df.copy()
        df['Weighted_Score'] = 0.0

        for metric, weight in weights.items():
            values = df[metric].values

            if metric == 'R2':
                normalized = (values - values.min()) / (values.max() - values.min() + 1e-10)
                normalized = 1 - normalized
            else:
                normalized = (values - values.min()) / (values.max() - values.min() + 1e-10)

            df['Weighted_Score'] += normalized * weight

        df_sorted = df.sort_values('Weighted_Score')

        print("\n" + "="*70)
        print("WEIGHTED RANKING RESULTS")
        print("="*70)
        print(f"Weights used: {weights}")
        print("\nRanking (lower score = better):")
        print("-"*70)

        for idx, row in df_sorted.iterrows():
            print(f"{row['Model']:30s} Score: {row['Weighted_Score']:.4f}")

        print("="*70)

        best_model = df_sorted.iloc[0]['Model']
        scores = dict(zip(df_sorted['Model'], df_sorted['Weighted_Score']))

        return best_model, scores





