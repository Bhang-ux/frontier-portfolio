"""
Golden-fixture generator for @frontier/quant.

The TypeScript engine is validated against independent, widely used Python
implementations: scikit-learn (Ledoit-Wolf), PyPortfolioOpt (constant-
correlation shrinkage, HRP, Black-Litterman) and CVXPY with the Clarabel /
HiGHS solvers (every convex optimisation objective). Inputs are generated
here from a seeded factor model and stored alongside the reference outputs,
so the TS tests consume byte-identical data.

Usage:  python tools/reference/generate_fixtures.py
Output: packages/quant/test/fixtures/golden.json
"""

from __future__ import annotations

import json
import pathlib

import cvxpy as cp
import numpy as np
import pandas as pd
import scipy.cluster.hierarchy as sch

# PyPortfolioOpt 1.6 validates `linkage_method` against a private SciPy table
# that SciPy >= 1.15 no longer exposes. Restore it (membership check only).
if not hasattr(sch, "_LINKAGE_METHODS"):
    sch._LINKAGE_METHODS = {"single": 0, "complete": 1, "average": 2, "centroid": 3, "median": 4, "ward": 5, "weighted": 6}

from pypfopt import BlackLittermanModel, HRPOpt  # noqa: E402
from pypfopt.risk_models import CovarianceShrinkage  # noqa: E402
from scipy import stats  # noqa: E402
from sklearn.covariance import ledoit_wolf  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "packages" / "quant" / "test" / "fixtures" / "golden.json"
SOLVER = cp.CLARABEL
PPY = 252


def factor_returns(T: int, n: int, seed: int) -> np.ndarray:
    """Daily returns from a 2-factor model with heterogeneous betas and drifts."""
    rng = np.random.default_rng(seed)
    market = rng.normal(0.0004, 0.011, T)
    style = rng.normal(0.0, 0.006, T)
    b_mkt = rng.uniform(0.3, 1.5, n)
    b_sty = rng.uniform(-1.0, 1.0, n)
    idio = rng.uniform(0.004, 0.02, n)
    drift = rng.uniform(-0.0002, 0.0006, n)
    eps = rng.normal(0.0, 1.0, (T, n)) * idio
    return drift + np.outer(market, b_mkt) + np.outer(style, b_sty) + eps


def solve_mv(mu, S, lam, ub, groups=None):
    n = len(mu)
    w = cp.Variable(n)
    cons = [cp.sum(w) == 1, w >= 0, w <= ub]
    for g in groups or []:
        if "upper" in g:
            cons.append(cp.sum(w[g["members"]]) <= g["upper"])
        if "lower" in g:
            cons.append(cp.sum(w[g["members"]]) >= g["lower"])
    obj = cp.Minimize(0.5 * lam * cp.quad_form(w, cp.psd_wrap(S)) - mu @ w) if lam is not None else cp.Minimize(cp.quad_form(w, cp.psd_wrap(S)))
    cp.Problem(obj, cons).solve(solver=SOLVER)
    return np.asarray(w.value).clip(0)


def solve_max_sharpe(mu, S, rf, ub):
    """Tangency portfolio via the Cornuejols-Tutuncu homogenisation."""
    n = len(mu)
    y = cp.Variable(n)
    k = cp.Variable()
    cons = [(mu - rf) @ y == 1, y >= 0, y <= ub * k, cp.sum(y) == k, k >= 0]
    cp.Problem(cp.Minimize(cp.quad_form(y, cp.psd_wrap(S))), cons).solve(solver=SOLVER)
    return np.asarray(y.value / k.value).clip(0)


def solve_target_return(mu, S, target, ub):
    n = len(mu)
    w = cp.Variable(n)
    cons = [cp.sum(w) == 1, w >= 0, w <= ub, mu @ w >= target]
    cp.Problem(cp.Minimize(cp.quad_form(w, cp.psd_wrap(S))), cons).solve(solver=SOLVER)
    return np.asarray(w.value).clip(0)


def solve_target_vol(mu, S, vol, ub):
    n = len(mu)
    w = cp.Variable(n)
    cons = [cp.sum(w) == 1, w >= 0, w <= ub, cp.quad_form(w, cp.psd_wrap(S)) <= vol**2]
    cp.Problem(cp.Maximize(mu @ w), cons).solve(solver=SOLVER)
    return np.asarray(w.value).clip(0)


def solve_risk_parity(S):
    n = S.shape[0]
    y = cp.Variable(n, pos=True)
    b = np.full(n, 1.0 / n)
    cp.Problem(cp.Minimize(0.5 * cp.quad_form(y, cp.psd_wrap(S)) - b @ cp.log(y))).solve(solver=SOLVER)
    w = np.asarray(y.value)
    return w / w.sum()


def solve_min_cvar(R, alpha, ub):
    T, n = R.shape
    w = cp.Variable(n)
    z = cp.Variable(T)
    zeta = cp.Variable()
    cons = [cp.sum(w) == 1, w >= 0, w <= ub, z >= 0, z >= -R @ w - zeta]
    prob = cp.Problem(cp.Minimize(zeta + cp.sum(z) / ((1 - alpha) * T)), cons)
    prob.solve(solver=cp.HIGHS)
    return np.asarray(w.value).clip(0), float(prob.value)


def hist_cvar(R, w, alpha):
    losses = np.sort(-(R @ w))
    var = np.quantile(losses, alpha)  # numpy linear interpolation (type 7)
    tail = losses[losses >= var]
    return float(tail.mean())


def metrics_reference(r: np.ndarray, rf_annual: float):
    rf = (1 + rf_annual) ** (1 / PPY) - 1
    wealth = np.concatenate([[1.0], np.cumprod(1 + r)])
    peak = np.maximum.accumulate(wealth)
    dd = wealth / peak - 1
    downside = np.minimum(r - rf, 0)
    dd_dev = np.sqrt(np.mean(downside**2)) * np.sqrt(PPY)
    vol = r.std(ddof=1) * np.sqrt(PPY)
    s = pd.Series(r)
    return {
        "cagr": float(np.expm1(np.log1p(r).sum() * PPY / len(r))),
        "volatility": float(vol),
        "sharpe": float((r.mean() - rf) * PPY / vol),
        "sortino": float((r.mean() - rf) * PPY / dd_dev),
        "maxDrawdown": float(-dd.min()),
        "skewness": float(s.skew()),
        "kurtosis": float(s.kurt()),
        "varHistorical": float(-np.quantile(r, 0.05)),
    }


def main():
    T, n = 600, 8
    X = factor_returns(T, n, seed=20240611)
    df = pd.DataFrame(X, columns=[f"A{i}" for i in range(n)])

    # --- covariance estimators -------------------------------------------
    lw_cov, lw_shrink = ledoit_wolf(X)
    cs = CovarianceShrinkage(df, returns_data=True, frequency=1)
    cc_cov = cs.ledoit_wolf(shrinkage_target="constant_correlation")
    cc_delta = float(cs.delta)
    sample = np.cov(X, rowvar=False, ddof=1)

    # --- optimiser inputs (annualised) -----------------------------------
    mu = X.mean(axis=0) * PPY
    S = np.asarray(cc_cov) * PPY
    rf = 0.02
    ub = 0.4

    gmv = solve_mv(mu, S, None, ub)
    lam = 4.0
    util = solve_mv(mu, S, lam, ub)
    tangency = solve_max_sharpe(mu, S, rf, ub)
    ret_gmv = float(mu @ gmv)
    target_ret = float(ret_gmv + 0.5 * (float(mu @ tangency) - ret_gmv))
    tr = solve_target_return(mu, S, target_ret, ub)
    target_vol = float(np.sqrt(gmv @ S @ gmv) * 1.25)
    tv = solve_target_vol(mu, S, target_vol, ub)
    groups = [{"members": [0, 1, 2], "upper": 0.35}, {"members": [5, 6], "lower": 0.25}]
    grouped = solve_mv(mu, S, lam, ub, groups)
    sigma = np.sqrt(np.diag(S))
    maxdiv = solve_max_sharpe(sigma, S, 0.0, ub)
    erc = solve_risk_parity(S)
    cvar_w, cvar_val = solve_min_cvar(X, 0.95, ub)

    # --- HRP ----------------------------------------------------------------
    hrp = HRPOpt(df)
    hrp_w = hrp.optimize(linkage_method="single")
    hrp_weights = [float(hrp_w[c]) for c in df.columns]

    # --- Black-Litterman --------------------------------------------------
    w_mkt = np.full(n, 1 / n)
    delta = 2.5
    pi = delta * S @ w_mkt
    P = np.zeros((2, n))
    P[0, 0] = 1.0  # absolute view on A0
    P[1, 1], P[1, 2] = 1.0, -1.0  # A1 outperforms A2
    Q = np.array([0.08, 0.03])
    conf = [0.6, 0.3]
    bl = BlackLittermanModel(pd.DataFrame(S), pi=pi, P=P, Q=Q, omega="idzorek", view_confidences=conf, tau=0.05)
    bl_ret = np.asarray(bl.bl_returns())
    bl_cov = np.asarray(bl.bl_cov())
    bl_default = BlackLittermanModel(pd.DataFrame(S), pi=pi, P=P, Q=Q, tau=0.05)
    bl_ret_default = np.asarray(bl_default.bl_returns())

    # --- misc numerics ------------------------------------------------------
    portfolio = X @ np.full(n, 1 / n)
    bench = X[:, 0]
    Xreg = np.column_stack([np.ones(T), bench, X[:, 1]])
    coef, *_ = np.linalg.lstsq(Xreg, portfolio, rcond=None)
    resid = portfolio - Xreg @ coef
    sigma2 = resid @ resid / (T - 3)
    se = np.sqrt(np.diag(sigma2 * np.linalg.inv(Xreg.T @ Xreg)))
    r2 = 1 - (resid @ resid) / ((portfolio - portfolio.mean()) @ (portfolio - portfolio.mean()))
    evals, _ = np.linalg.eigh(S)
    probs = [0.001, 0.01, 0.025, 0.05, 0.1, 0.3, 0.5, 0.7, 0.95, 0.975, 0.99, 0.9999]

    out = {
        "meta": {"T": T, "n": n, "ppy": PPY, "rf": rf, "ub": ub, "lambda": lam, "generator": "tools/reference/generate_fixtures.py"},
        "returns": X.tolist(),
        "covariance": {
            "sample": sample.tolist(),
            "ledoitWolfIdentity": {"cov": np.asarray(lw_cov).tolist(), "shrinkage": float(lw_shrink)},
            "ledoitWolfConstantCorrelation": {"cov": np.asarray(cc_cov).tolist(), "shrinkage": cc_delta},
        },
        "optimizer": {
            "mu": mu.tolist(),
            "cov": S.tolist(),
            "minVariance": gmv.tolist(),
            "maxUtility": util.tolist(),
            "maxSharpe": tangency.tolist(),
            "targetReturn": {"target": target_ret, "weights": tr.tolist()},
            "targetVolatility": {"target": target_vol, "weights": tv.tolist()},
            "grouped": {"groups": groups, "weights": grouped.tolist()},
            "maxDiversification": maxdiv.tolist(),
            "riskParity": erc.tolist(),
            "minCvar": {"alpha": 0.95, "weights": cvar_w.tolist(), "objective": cvar_val, "historicalCvar": hist_cvar(X, cvar_w, 0.95)},
        },
        "hrp": {"weights": hrp_weights, "linkage": np.asarray(hrp.clusters).tolist()},
        "blackLitterman": {
            "pi": pi.tolist(),
            "P": P.tolist(),
            "Q": Q.tolist(),
            "confidences": conf,
            "tau": 0.05,
            "posteriorReturns": bl_ret.tolist(),
            "posteriorCov": bl_cov.tolist(),
            "posteriorReturnsDefaultOmega": bl_ret_default.tolist(),
        },
        "metrics": {"returns": portfolio.tolist(), "benchmark": bench.tolist(), "rf": 0.03, "expected": metrics_reference(portfolio, 0.03)},
        "ols": {"coef": coef.tolist(), "stdErr": se.tolist(), "rSquared": float(r2)},
        "eigen": {"values": sorted(evals.tolist(), reverse=True)},
        "normal": {"p": probs, "ppf": [float(stats.norm.ppf(p)) for p in probs], "cdfAt": [-3, -1.5, 0, 0.7, 2.2], "cdf": [float(stats.norm.cdf(x)) for x in [-3, -1.5, 0, 0.7, 2.2]]},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KiB)")
    print("tangency", np.round(tangency, 4), "sharpe", (mu @ tangency - rf) / np.sqrt(tangency @ S @ tangency))
    print("hrp", np.round(hrp_weights, 4))
    print("min cvar", cvar_val)


if __name__ == "__main__":
    main()
