# PyBaMM Architecture - Quick Reference

## System Overview Diagram

```
USER CODE
  │
  └─→ pybamm.Simulation(model, experiment, solver)
        │
        ├─ model.build_model()           [Assemble physics]
        ├─ discretisation.discretise()   [Convert PDE→ODE]
        ├─ solver.solve(t_eval, y0)      [Integrate]
        └─ solution.plot()               [Visualize]
```

## Dependency Hierarchy

```
HIGH-LEVEL (User-Facing)
    ↓
[Experiment] [ParameterValues] [Geometry]
    ↓ ↓ ↓
Simulation
    ↓
BaseBatteryModel (DFN, SPM, etc.)
    ├─ Submodels (pluggable physics)
    └─ Expression Tree (symbolic math)
    ↓
Discretisation (spatial methods)
    ↓
Solver (ODE/DAE integrator)
    ↓
LOW-LEVEL (Numerical computation)
```

## Model Hierarchy

```
BaseModel (Abstract)
    ↓
BaseBatteryModel (Battery-specific)
    ├─ Lithium-Ion Models
    │   ├─ SPM          (Simplest)
    │   ├─ SPMe         (w/ electrolyte)
    │   ├─ DFN          (Most common)
    │   ├─ MSMR         (Multi-scale particle)
    │   ├─ MPM          (Mesoscale)
    │   └─ Half-Cell    (Single electrode)
    │
    ├─ Lead-Acid Models
    │   ├─ Full         (Detailed)
    │   └─ LOQS         (Simplified)
    │
    ├─ Sodium-Ion Models
    │   └─ BasicDFN     (DFN for Na-ion)
    │
    └─ ECM (Equivalent Circuit)
        └─ Thevenin    (RC ladder)
```

## Submodel Categories

```
Full Models combine these pluggable components:

├─ Particle Diffusion
│  ├─ Fickian Diffusion
│  ├─ MSMR (Multi-scale multi-reaction)
│  └─ Polynomial Profile
│
├─ Interface Kinetics
│  ├─ Butler-Volmer
│  ├─ Marcus Theory
│  ├─ Linear Kinetics
│  └─ Diffusion-Limited
│
├─ Open Circuit Potential
│  ├─ Single OCP
│  ├─ MSMR OCP
│  └─ Hysteresis Models
│
├─ Solid-Electrolyte Interface
│  ├─ Constant SEI
│  ├─ SEI Growth
│  └─ No SEI
│
├─ Electrode Physics
│  ├─ Ohmic Drop (various complexity levels)
│  ├─ Current Collector
│  └─ Active Material Loss
│
├─ Electrolyte Transport
│  ├─ Conductivity (full, leading-order)
│  ├─ Diffusion
│  └─ Convection (internal flow)
│
├─ Thermal Effects
│  ├─ Isothermal
│  ├─ Lumped (single temperature)
│  ├─ Distributed 1D/2D/3D
│  └─ Pouch Cell Specific
│
└─ Other Physics
   ├─ Porosity
   ├─ Transport Efficiency
   ├─ Particle Mechanics
   └─ Lithium Plating
```

## Expression Tree Structure

```
Symbols (Leaf Nodes):
├─ Variable(y)           → State vector entry
├─ Parameter(σ)          → Model coefficient
├─ Scalar(3.14)          → Constant
├─ StateVector           → Discretized spatial grid
└─ InputParameter(I)     → Time-varying current

Operations (Internal Nodes):
├─ Binary: +, -, *, /, power
├─ Unary: exp, log, sin, cos
├─ Broadcast: repeat, reshape
└─ Concatenate: stack vectors

Root: dy/dt = RHS_expression
```

## Discretisation Flow

```
Continuous Domains
  ↓ [Choose spatial method]
  ├─ Finite Volume (FV)
  ├─ Spectral Volume (SV)
  ├─ Finite Element (FEM)
  └─ Zero-Dimensional (lumped)
  ↓ [Generate mesh]
  ├─ 1D: Uniform/non-uniform line
  ├─ 2D: Cartesian/polar grid
  └─ 3D: Tetrahedral (scikit-fem)
  ↓ [Apply operators]
  ├─ Gradient (∇)
  ├─ Divergence (∇·)
  └─ Laplacian (∇²)
  ↓ [Apply boundary conditions]
  ├─ Dirichlet (fixed value)
  ├─ Neumann (fixed flux)
  └─ Robin (mixed)
  ↓
Discrete DAE System: M*dy/dt = f(t,y) + g_alg(t,y) = 0
```

## Solver Selection Strategy

```
Model Type → Solver Choice

Algebraic only          → AlgebraicSolver
                           
ODE only
├─ Speed priority       → IDAKLUSolver (C++)
├─ Accuracy priority    → CasadiSolver (symbolic)
├─ GPU available        → JAXSolver (JIT)
└─ Portability          → ScipySolver (pure Python)

DAE (ODE + algebraic)
├─ Default              → IDAKLUSolver
├─ Complex Jacobian     → CasadiSolver
├─ Large-scale          → IDAKLUSolver + JAX
└─ Testing              → DummySolver
```

## Data Flow: Solve Pipeline

```
┌────────────────────────────────────────────────────┐
│ 1. Model Specification                             │
│    model = pybamm.lithium_ion.DFN()                │
└────────────┬───────────────────────────────────────┘
             │
┌────────────▼───────────────────────────────────────┐
│ 2. Parameter Assignment                            │
│    param_vals.process_model(model)                 │
│    [Symbols → Numbers]                             │
└────────────┬───────────────────────────────────────┘
             │
┌────────────▼───────────────────────────────────────┐
│ 3. Build Model                                     │
│    model.build_model()                             │
│    [Assemble RHS: m*dy/dt = f(t,y)]              │
└────────────┬───────────────────────────────────────┘
             │
┌────────────▼───────────────────────────────────────┐
│ 4. Discretisation                                  │
│    disc.discretise(model)                          │
│    [Convert PDE → ODE using spatial method]       │
└────────────┬───────────────────────────────────────┘
             │
┌────────────▼───────────────────────────────────────┐
│ 5. Prepare for Solving                             │
│    ├─ Compute Jacobian (symbolic or auto-diff)    │
│    ├─ Setup events (voltage threshold, etc.)      │
│    └─ Extract initial conditions (y0)             │
└────────────┬───────────────────────────────────────┘
             │
┌────────────▼───────────────────────────────────────┐
│ 6. Solve                                           │
│    solver.solve(t_eval=[0,3600])                   │
│    [Time-stepping: y(t) ← ODE integrator]         │
└────────────┬───────────────────────────────────────┘
             │
┌────────────▼───────────────────────────────────────┐
│ 7. Post-Process                                    │
│    solution.compute_variable("Current")            │
│    [Evaluate derived quantities from y(t)]        │
└────────────┬───────────────────────────────────────┘
             │
┌────────────▼───────────────────────────────────────┐
│ 8. Visualize                                       │
│    solution.plot()                                 │
│    [Render voltage, temperature, etc. vs. time]   │
└────────────────────────────────────────────────────┘
```

## Key Classes & Interfaces

```
BaseModel (Abstract)
├─ submodels: Dict[str, BaseSubmodel]
├─ _rhs: Dict[str, Symbol]          → RHS expressions
├─ _algebraic: Dict[str, Symbol]    → Algebraic constraints
├─ _variables: FuzzyDict[str, Symbol]
├─ build_model()                    → Assemble equations
├─ set_rhs()                        → Add RHS equation
├─ set_algebraic()                  → Add algebraic constraint
└─ set_boundary_conditions()        → Apply BCs

Discretisation
├─ mesh: Dict[str, Mesh]
├─ spatial_methods: Dict[str, SpatialMethod]
├─ discretise(model)                → Convert PDE→ODE
└─ process_boundary_conditions()

BaseSolver (Abstract)
├─ _integrate(t_eval, y0, model)
├─ solve(t_eval, y0)                → Solve + return Solution
├─ handle_events()                  → Trigger on conditions
└── compute_jacobian()              → ∂f/∂y matrix

Solution
├─ t: ndarray                        → Time points
├─ y: ndarray                        → State vectors
├─ compute_variable(name)            → Evaluate derived quantity
├─ plot()                            → Quick visualization
└─ save/load                         → Persistence
```

## Parameter System

```
Parameter (Symbol)
     ↓ (in model building)
Expression Tree
     ↓ (before solving)
ParameterValues.process_model()
     ↓
Parameter → Literal Value (float, array)
     ↓ (substituted into expression tree)
Expression Tree (numerical, ready to solve)
```

## File Statistics

```
Total Files:     973
├─ Python files:     ≈ 800
├─ Jupyter notebooks: ≈ 50
├─ Documentation:    ≈ 100
└─ Other:           ≈ 23

Code Statistics:
├─ Functions:      4,342
├─ Classes:          735
├─ Interfaces:         0
└─ Methods:          ~2,000

Hottest Files (by connections):
├─ src/pybamm/__init__.py                    (500 connections)
├─ src/pybamm/expression_tree/variable.py    (474 connections)
├─ src/pybamm/expression_tree/scalar.py      (397 connections)
├─ src/pybamm/models/base_model.py           (305 connections)
└─ src/pybamm/discretisations/discretisation.py (289 connections)
```

## Performance Tiers

```
Fastest (< 1 sec)     Slowest (> 10 sec)
  ↓                        ↓
IDAKLUSolver (C++)    CasadiSolver (sym opt)
JAXSolver (GPU)       Complex 3D models
ScipySolver           Large parameter sweeps
  ↓
DummySolver (debug)
```

## Extension Points

Want to add something? Extend these:

```
Custom Model
  └─ Inherit from BaseBatteryModel
     └─ Override build_model(), set_rhs(), etc.

Custom Submodel
  └─ Inherit from BaseSubModel
     └─ Define physics equations

Custom Spatial Method
  └─ Inherit from SpatialMethod
     └─ Implement discretise_operator()

Custom Solver
  └─ Inherit from BaseSolver
     └─ Implement _integrate()

Custom Parameter Set
  └─ Dict of {"symbol_name": numerical_value}
```

## Common Workflows

### Quick Discharge Curve
```python
model = pybamm.lithium_ion.SPM()
sim = pybamm.Simulation(model)
sim.solve([0, 3600])
sim.plot()
```

### Multi-Model Comparison
```python
models = [
    pybamm.lithium_ion.SPM(),
    pybamm.lithium_ion.DFN(),
    pybamm.lithium_ion.MSMR()
]
for model in models:
    sim = pybamm.Simulation(model)
    sim.solve([0, 3600])
    sim.plot()
```

### Parameter Sensitivity
```python
batch = pybamm.BatchStudy(...)
batch.solve(...)
# Multi-parameter sweep
```

### Thermal Model
```python
model = pybamm.lithium_ion.DFN(
    options={"thermal": "lumped"}
)
# Add temperature physics
```

---

*Quick reference for PyBaMM v1.x*



