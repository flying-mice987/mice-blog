# Hi, RISC-V

rCore的项目是运行在RISC-V架构上的, 所以先简要回顾一下RISC-V指令集

## registers

### base integer registers

x开头的寄存器为usize(x0-x31, pc 共33个)

|Register|ABI Name|Usage|save?|
|:------:|:------:|:---:|:---:|
|x0|zero|Zero **constant**|-|
|x1|ra|Return address|Callee|
|x2|sp|Stack pointer|Callee|
|x3|gp|Global pointer|—|
|x4|tp|Thread pointer|—|
|x5-x7|t0-t2|Temporaries|Caller|
|x8|s0/fp|Saved/framepointer|Callee|
|x9|s1|Saved register|Callee|
|x10-x11|a0-a1|Fn args/return values|Caller|
|x12-x17|a2-a7|Fn args|Caller|
|x18-x27|s2-s11|Saved registers|Callee|
|x28-x31|t3-t6|Temporaries|Caller|
|pc|pc|program counter|-|

## unprivileged ISA

[RISCV_CARD](https://www.cs.sfu.ca/~ashriram/Courses/CS295/assets/notebooks/RISCV/RISCV_CARD.pdf)

## previledged ISA

> The SYSTEM major opcode is used to encode all privileged instructions in the RISC-V ISA. These can be divided into two main classes: those that atomically read-modify-write control and status registers (CSRs), which are defined in the Zicsr extension, and all other privileged instructions. The privileged architecture requires the Zicsr extension; which other privileged instructions are required depends on the privileged-architecture feature set.\
> [RISC-V Specifications Vol.2 Ch.2](https://docs.riscv.org/reference/isa/priv/priv-csrs.html)

### CSRs(Control State Registers)
[RISC-V spec: Control and Status Registers (CSRs)](https://docs.riscv.org/reference/isa/priv/priv-csrs.html)

### Supervisor Trap Setup & Handling

|Name|RISCV spec Description|our usage|
|:--:|:--|:--:|
|sstatus|Supervisor status register|中断信息, 包含trap前的特权级|
|stvec|Supervisor trap handler base address|direct模式则为trap_handler地址|
|sscratch|Supervisor scratch register|rcore用于保存sp(栈指针)|
|sepc|Supervisor exception program counter|记录跳转时PC的地址(仍是最后一条指令, 所以sret之前应当spec+=4)|
|scause|Supervisor trap cause|中断原因(interrupt/exception)|
|stval|Supervisor trap value|exception发生的pc地址|
|sip|Supervisor interrupt pending||

#### sstatus
![sstatus figure](https://docs.riscv.org/reference/isa/priv/_images/svg-f96a49ba3c356808d7a18da0f227529f7dde5569.svg)

> The SIE bit enables or disables all interrupts in supervisor mode. When SIE is clear, interrupts are not taken while in supervisor mode. When the hart is running in user-mode, the value in SIE is ignored, and supervisor-level interrupts are enabled. The supervisor can disable individual interrupt sources using the sie CSR.

SIE and SPIE: SIE控制是否允许supervisor mode trap handling, SPIE是user trap之前的SIE状态, user trap进入S模式时**SIE被设为0**, 而SPIE记住之前的SIE状态, 而sret时SIE被设为SPIE然后**SPIE被设为1**. 因此我们可以通过设置SPIE来控制trap之后的中断是否开启.

#### `ecall` and `sret`

U态通过`eccall`陷入更高的特权级, 最终跳转到stvec指向的指令. 同时相关信息会被保存在各个CSR中

`sret`则允许特权级下降, 会跳转到spec对应的指令
