# PyBaMM Architecture - End-to-End Analysis

## Executive Summary

**PyBaMM** (Python Battery Mathematical Modelling) is a comprehensive, open-source framework for modeling and simulating battery behavior. The project contains **973 files**, **4,342 functions**, and **735 classes** organized in a layered architecture optimized for modularity, extensibility, and scientific computation.

---

## 🏗️ High-Level Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│  USER INTERFACE & EXAMPLES                                  │
│  (Jupyter Notebooks, Scripts, Experiments)                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  SIMULATION & EXPERIMENT ORCHESTRATION LAYER                │
│  • Simulation      - High-level simulation runner           │
│  • Experiment      - Define charging/discharging cycles     │
│  • BatchStudy      - Multi-parameter studies                │
│  • Callbacks       - Monitor simulation progress            │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  MODEL LAYER (Hierarchical)                                 │
├─ BaseBatteryModel (Physical domain constraints)            │
├─ Full Models:                                              │
│  ├─ Lithium-Ion (DFN, SPM, SPMe, MPM, MSMR, etc.)        │
│  ├─ Lead-Acid (Full, LOQS models)                         │
│  ├─ Sodium-Ion (emerging battery chemistry)               │
│  └─ Equivalent Circuit Models (ECM)                        │
├─ Submodels (Pluggable domain-specific components):        │
│  ├─ Particle Diffusion (kinetics in electrodes)           │
│  ├─ Electrode Kinetics (Butler-Volmer, Marcus, etc.)      │
│  ├─ Interface Chemistry (SEI growth, Li-plating, OCP)     │
│  ├─ Thermal Management (lumped, distributed 1D-3D)        │
│  ├─ Current Collector Physics                             │
│  ├─ Electrolyte Transport (conductivity, diffusion)       │
│  ├─ Convection (internal circulation)                     │
│  ├─ Porosity & Tortuosity (pore network)                  │
│  └─ Active Material Loss (cycling degradation)            │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  EXPRESSION TREE (Symbolic Computation Layer)              │
│  Directed Acyclic Graph (DAG) of mathematical expressions │
├─ Symbol                  - Base class for all nodes        │
│  ├─ Variable             - State vector entries            │
│  ├─ Parameter            - Model parameters               │
│  ├─ Scalar/Array         - Constants                       │
│  ├─ StateVector          - Discretized spatial domain     │
│  └─ InputParameter       - Time-varying inputs            │
├─ Operators                                                 │
│  ├─ BinaryOperators      - +, -, *, /, power, etc.       │
│  ├─ UnaryOperators       - exp, log, sin, cos, etc.      │
│  ├─ Concatenations       - Stack vectors                  │
│  └─ Broadcasts           - Repeat/tile operations         │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  DISCRETISATION LAYER (PDE → ODE/DAE Conversion)           │
│  Transforms continuous PDEs into discrete systems         │
├─ Discretisation         - Master converter class           │
├─ Spatial Methods:                                          │
│  ├─ FiniteVolume         - 1D/2D finite volume schemes    │
│  ├─ SpectralVolume       - Spectral approach              │
│  ├─ ScikitFiniteElement  - 1D unstructured meshes         │
│  ├─ ScikitFiniteElement3D- 3D tetrahedral meshes          │
│  └─ ZeroDimensionalMethod- Lumped (0D) approximations    │
├─ Meshes:                                                   │
│  ├─ 1D Submeshes         - Line domains                   │
│  ├─ 2D Submeshes         - Sheet domains                  │
│  ├─ 3D Submeshes         - Volume domains (via scikit-fem)│
│  └─ Composite Meshes     - Combined domains               │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  SOLVER LAYER (DAE System Integration)                      │
│  Converts discrete system → numerical solution             │
├─ Solver Interfaces:                                        │
│  ├─ BaseSolver           - Abstract interface             │
│  ├─ ODE Solvers:                                          │
│  │  ├─ ScipySolver       - scipy.integrate.ode           │
│  │  ├─ JAXSolver         - JAX backend (jit-compiled)    │
│  │  ├─ JAXBDFSolver      - JAX BDF method                │
│  │  └─ IDAKLUSolver      - SUNDIALS IDA (C++ wrapper)    │
│  ├─ DAE Solvers:                                          │
│  │  ├─ CasadiSolver      - CasADi symbolic optimization  │
│  │  ├─ IDakluJax         - IDA + JAX hybrid              │
│  │  └─ AlgebraicSolver   - Solve algebraic eqns only    │
│  └─ Special:                                              │
│     ├─ DummySolver       - Testing/debugging              │
│     └─ Solution          - Stores results + post-process  │
├─ Features:                                                 │
│  ├─ Jacobian Computation - Auto diff or symbolic         │
│  ├─ Event Detection      - Trigger on state changes      │
│  ├─ Callbacks            - Hooks during integration      │
│  └─ Processed Variables  - Post-compute derived quantities│
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  PARAMETER & DATA LAYER                                     │
│  Manages model coefficients and experimental data          │
├─ ParameterValues        - Substitutes symbols → numbers   │
├─ Parameter Sets:                                          │
│  ├─ Lithium-Ion Parameter Sets (Chen2020, OKane2022, etc)│
│  ├─ Lead-Acid Parameter Sets (Sulzer2019)                │
│  ├─ Sodium-Ion Parameter Sets (Chayambuka2022)           │
│  └─ ECM Parameter Sets (voltage model coefficients)       │
├─ Special Parameters:                                      │
│  ├─ ElectricalParameters - Conductivity, diffusivity     │
│  ├─ ThermalParameters    - Heat capacity, conductivity   │
│  ├─ GeometricParameters  - Dimensions, areas, volumes    │
│  └─ ProcessParameterData - Fit to experimental results   │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  VISUALIZATION & POST-PROCESSING                            │
│  Analysis and interpretation of results                    │
├─ Plotting Modules:                                        │
│  ├─ quick_plot()         - 1-line quick visualization    │
│  ├─ plot()               - Customizable plotting          │
│  ├─ plot_voltage_components()    - Decompose voltage    │
│  ├─ plot_summary_variables()     - Key metrics          │
│  ├─ plot_3d_heatmap()    - 3D temperature fields        │
│  └─ plot_3d_cross_section()      - 2D slices of 3D     │
├─ Dynamic Plotting:                                        │
│  └─ DynamicPlot          - Live update during solving   │
└──────────────────────────────────────────────────────────────┘
```

---

## 📊 Core Components Deep Dive

### 1. **Expression Tree (Symbolic Computation)**

**Purpose:** Represents mathematical expressions as a directed acyclic graph (DAG).

**Key Classes:**

```
Symbol (Base Class)
├── Variable              - Represents y(t), y_dot(t)
├── Parameter            - Fixed model coefficients
├── Scalar/Array         - Numerical constants
├── StateVector          - Discretized spatial variables
├── InputParameter       - Time-varying inputs (current, temperature)
│
BinaryOperator
├── Addition/Subtraction
├── Multiplication/Division
├── Power
├── MatrixMultiplication
└── Equality (for algebraic equations)

UnaryOperator
├── Exponential, Logarithm
├── Trigonometric (sin, cos, tan)
├── Sign, Absolute Value
└── Specialized (exp, log, cosh, etc.)
```

**Why This Matters:**
- Enables **symbolic differentiation** (Jacobian computation)
- **Backend-agnostic**: Same expression can be evaluated as Python, CasADi, or JAX code
- Supports **automatic code generation** for performance

---

### 2. **Model Hierarchy**

**Top Level: `BaseModel`**
- Holds empty RHS and algebraic equation dictionaries
- Manages variables, parameters, boundary conditions
- Coordinates discretisation and conversion

**Next Level: `BaseBatteryModel`**
- Enforces battery-specific physics constraints
- Implements standard lifecycle: `build_model()` → `discretise()` → `solve()`

**Bottom Level: Concrete Models (Plug-and-Play Architecture)**

| Model | Type | Complexity | Use Case |
|-------|------|-----------|----------|
| **SPM** | Lithium-Ion | Simplest | Quick simulations, education |
| **SPMe** | Lithium-Ion | Medium | Semi-empirical electrolyte |
| **DFN** | Lithium-Ion | Complex | High accuracy, research |
| **MSMR** | Lithium-Ion | Very Complex | Multi-scale particle size dist. |
| **MPM** | Lithium-Ion | Complex | Mesoscale particle modeling |
| **Half-Cell** | Lithium-Ion | Custom | Single electrode testing |
| **Thermal Models** | Any | Adds complexity | Temperature effects |
| **ECM (Thevenin)** | Equivalent Circuit | Simple | Real-time estimation |

**Submodel Pattern:**
```
Full Models = Combination of pluggable submodels

Example: DFN Model
├── Active Material (constant or loss)
├── Particle Diffusion (negative & positive electrodes)
├── Electrode Kinetics (interface reactions)
├── Open Circuit Potential (voltage lookup)
├── SEI Growth (lithium loss)
├── Current Collector (ohmic drop)
├── Convection (internal flow)
├── Thermal (heat generation & transfer)
└── External Circuit (boundary conditions)
```

---

### 3. **Discretisation Pipeline**

**Convert PDEs → Finite-Dimensional ODEs/DAEs**

```
Physics-Based PDE
     ↓
[Spatial Method Selected: Finite Volume / Spectral / FEM]
     ↓
Mesh Generation (1D/2D/3D depending on model)
     ↓
Gradient/Divergence Operators Discretized
     ↓
Boundary Conditions Applied
     ↓
Expression Tree Converted (y → discretized vector)
     ↓
Final System: M*dy/dt = f(t,y) + g(t,y) = 0  [DAE form]
```

**Mesh Strategy:**
- **1D**: Uniform or non-uniform grids (electrodes, separator)
- **2D**: Cartesian or polar (pouch cell cross-sections)
- **3D**: Tetrahedral (scikit-fem), complex geometries

---

### 4. **Solver Pipeline**

**Goal:** Integrate DAE system over time

**Solver Family:**
- **ScipySolver**: Reliable, well-tested, pure Python
- **CasadiSolver**: Symbolic optimization, slow but accurate
- **IDAKLUSolver**: C++ SUNDIALS, fastest
- **JAXSolver**: JIT-compiled, GPU-capable
- **IDakluJax**: Hybrid IDA + JAX

**Key Features:**
- **Event Detection**: Stop when voltage hits limit
- **Jacobian**: Computed symbolically or via auto-diff
- **Callbacks**: Monitor state during integration
- **Mass Matrix**: Handle DAE systems with singular mass matrices

---

### 5. **Parameter System**

**Strategy:** Keep symbolic model separate from numerical values

```
Model Construction:
  pybamm.Parameter("Conductivity") → generic symbol
     ↓
  [Stored in expression tree]
     ↓
Before Solving:
  parameter_values = pybamm.ParameterValues({
    "Conductivity": 1.23  # Numerical value
  })
  parameter_values.process_model(model)
     ↓
  All symbols substituted with values
     ↓
  Ready to solve!
```

**Pre-built Parameter Sets:**
- **Lithium-Ion**: Chen2020, OKane2022, Ai2020, Ecker2015, ORegan2022
- **Lead-Acid**: Sulzer2019
- **Sodium-Ion**: Chayambuka2022
- **ECM**: Thevenin model coefficients

---

## 🔄 Execution Flow: From Model to Solution

### Example: Simple SPM Simulation

```python
import pybamm

# Step 1: Create model
model = pybamm.lithium_ion.SPM()

# Step 2: Define simulation
sim = pybamm.Simulation(
    model,
    parameter_values=pybamm.ParameterValues("Chen2020"),
    solver=pybamm.IDAKLUSolver()
)

# Step 3: Run
sim.solve([0, 3600])  # Solve 1 hour

# Step 4: Plot
sim.plot()
```

**Behind the Scenes:**

1. **Model Initialization** → Submodels concatenated
2. **Build Phase** → RHS, algebraic equations assembled
3. **Parameter Substitution** → Symbols replaced with values
4. **Discretisation** → Spatial PDE → ODE/DAE
5. **Jacobian Computation** → Auto-differentiation
6. **Solver Setup** → Initial conditions, events configured
7. **Integration Loop** → Time-stepping with callbacks
8. **Post-Processing** → Compute derived variables (impedance, etc.)
9. **Visualization** → Plot results

---

## 🔗 Key Dependencies & Data Flow

### Upstream (Inputs)
```
Experiment (current profile)
    ↓
ParameterValues (physical constants)
    ↓
Geometry (cell dimensions)
    ↓
ModelOptions (choose submodels)
    ↓
BaseModel
```

### Downstream (Outputs)
```
Discretisation
    ↓
DAE System (M*dy/dt = f(t,y))
    ↓
Solver
    ↓
Solution object (t, y, processed_variables)
    ↓
Plotting/Analysis
    ↓
Results (voltage, capacity, temperature, etc.)
```

---

## 🌳 Hotspot Nodes (Most Connected Components)

These are the "hubs" that everything depends on:

| Node | Type | Connections | Role |
|------|------|-----------|------|
| `src/pybamm/__init__.py` | File | **500** | Central export hub |
| `Variable` | Class | **474** | Core state representation |
| `Scalar` | Class | **397** | Constant handling |
| `evaluate()` | Function | **344** | Expression evaluation |
| `solve()` | Function | **311** | Solver invocation |
| `BaseModel` | Class | **305** | Model parent |
| `Discretisation` | Class | **289** | Discretisation orchestration |
| `linspace()` | Function | **267** | Mesh generation |

---

## 📁 Directory Structure

```
src/pybamm/
├── models/                    # Model hierarchy
│   ├── base_model.py         # Abstract base
│   ├── full_battery_models/  # Concrete implementations
│   │   ├── lithium_ion/
│   │   ├── lead_acid/
│   │   ├── sodium_ion/
│   │   └── equivalent_circuit/
│   └── submodels/            # Pluggable physics components
│       ├── interface/        # Electrode kinetics, SEI, OCP
│       ├── particle/         # Particle diffusion
│       ├── thermal/          # Heat transfer
│       ├── electrode/        # Ohmic drop
│       ├── convection/       # Internal flow
│       └── [more...]
│
├── expression_tree/          # Symbolic DAG
│   ├── symbol.py            # Base class
│   ├── binary_operators.py  # +, -, *, /
│   ├── unary_operators.py   # sin, exp, log
│   ├── operations/          # Evaluation, Jacobian, serialization
│   └── [more...]
│
├── discretisations/          # PDE → ODE conversion
│   └── discretisation.py
│
├── spatial_methods/          # Finite volume, spectral, FEM
│   ├── finite_volume.py
│   ├── spectral_volume.py
│   └── [more...]
│
├── meshes/                   # Grid generation
│   ├── meshes.py
│   └── [submesh types...]
│
├── solvers/                  # DAE integration
│   ├── base_solver.py
│   ├── scipy_solver.py
│   ├── casadi_solver.py
│   ├── idaklu_solver.py
│   └── [more...]
│
├── parameters/               # Physical coefficients
│   ├── base_parameters.py
│   ├── parameter_values.py
│   ├── lithium_ion_parameters.py
│   └── input/
│       └── parameters/       # Pre-built parameter sets
│
├── plotting/                 # Visualization
│   ├── plot.py
│   ├── quick_plot.py
│   ├── plot_voltage_components.py
│   └── [more...]
│
├── batch_study.py           # Multi-parameter studies
├── simulation.py            # High-level runner
├── experiment/              # Charge/discharge cycles
└── [more...]

tests/
├── unit/                    # Isolated component tests
└── integration/             # End-to-end tests
```

---

## 🎯 Design Patterns

### 1. **Plugin Architecture (Submodels)**
- Models are built by combining plug-and-play submodels
- Easy to swap implementations (e.g., different kinetics models)
- **Example**: Switch from Butler-Volmer to Marcus kinetics

### 2. **Expression Tree Pattern**
- Decouple symbolic math from backend
- Same expression → Python, CasADi, or JAX code
- Enables automatic differentiation

### 3. **Factory Pattern (Solvers)**
- `solve()` returns appropriate solver based on model type
- User doesn't need to know solver implementation details

### 4. **Strategy Pattern (Spatial Methods)**
- Choose discretization strategy (FV, Spectral, FEM) at runtime
- Swap without changing model code

### 5. **Template Method (Model Lifecycle)**
1. `model.build_model()`
2. `disc.discretise(model)`
3. `solver.solve(t_eval, y0)`

---

## 🚀 Performance Considerations

### Bottlenecks
1. **Discretisation**: Large spatial grids → huge state vectors
2. **Jacobian Computation**: Dense matrices for implicit solvers
3. **Parameter Substitution**: Re-expression tree traversal

### Optimizations
1. **CasADi Backend**: Symbolic optimization + JIT
2. **JAX Solver**: GPU acceleration, batched derivatives
3. **IDA Solver**: C++ wrapper, sparse Jacobian support
4. **LRU Caching**: Avoid recomputation

---

## 🔐 Testing Strategy

### Unit Tests (973 files)
- Component-level validation
- Expression tree operations
- Spatial method correctness

### Integration Tests
- Full model runs
- Solver convergence
- Different parameter sets

### Benchmark Tests
- Performance tracking
- Memory profiling
- Scaling analysis

---

## 📚 Key Math Concepts

### Governing Equations
**DAE System:**
```
M(t,y) * dy/dt = f(t, y, u(t))  [Differential equations]
0 = g(t, y, u(t))               [Algebraic equations]
```

where:
- `y` = state vector (concentrations, potentials, temperature)
- `u(t)` = inputs (applied current, ambient temperature)
- `M` = mass matrix (handles singular systems)

### Typical Physics

**Particle Diffusion (Fick's Law):**
```
∂c/∂t = ∇·(D∇c)
```

**Charge Conservation (Poisson):**
```
∇·(σ∇φ) = i
```

**Energy Balance (Heat Equation):**
```
ρCp ∂T/∂t = ∇·(k∇T) + Q_gen
```

---

## 🎓 Learning Path

1. **Start**: Run SPM model (`pybamm.lithium_ion.SPM()`)
2. **Progress**: Modify parameter set, change solver
3. **Intermediate**: Swap submodels (DFN, thermal)
4. **Advanced**: Create custom submodel
5. **Expert**: Implement new spatial method

---

## 🔮 Architecture Strengths

✅ **Modularity**: Plug-and-play submodels  
✅ **Extensibility**: Easy to add new models/solvers  
✅ **Physics-First**: Expression tree mirrors actual equations  
✅ **Backend-Agnostic**: Switch solvers without changing model  
✅ **Scientific Quality**: Validated against experiments  
✅ **Performance**: Multiple backends (Python, C++, JAX)  

---

## ⚠️ Architecture Tradeoffs

⚖️ **Complexity**: Large learning curve  
⚖️ **Symbolic Overhead**: DAG construction has memory cost  
⚖️ **Debug Difficulty**: Multiple abstraction layers  
⚖️ **Startup Time**: Model compilation + discretisation  

---

## 🎯 Conclusion

PyBaMM's architecture is a **layered, modular system** optimized for:
- **Scientific fidelity** (physics-based discretisation)
- **Extensibility** (plug-and-play submodels)
- **Performance** (multiple backends)
- **Usability** (high-level simulation API)

The design cleanly separates concerns across 7 layers, from symbolic math to numerical solvers, making it suitable for both research and production use.

---

*Analysis powered by GitNexus MCP - Code Intelligence Engine*



