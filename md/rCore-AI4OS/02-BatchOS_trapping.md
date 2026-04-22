# 02-BatchOS: trapping

[rCore Tutorial Guide](https://learningos.cn/rCore-Tutorial-Guide/)的第一章没什么重要的(主要是配环境什么的), 所以直接从第二章开始. BatchOS 中引入了Trap的概念, 使得OS不再是一个lib而成为了Supervisor.

## Context 保存结构设计

```rust
#[repr(C)]
pub struct LocalContext {
    /// 调度上下文保存区指针（由裸汇编切换时使用）。
    sctx: usize, // 这储存了switch之前的sp(ctx保存位置)
    /// 通用寄存器 x1..x31 的镜像（x0 恒为 0，不保存）。
    x: [usize; 31],
    /// 返回用户/内核线程时的 PC（对应 sepc）。
    sepc: usize,
    /// 是否以特权态切换。
    pub supervisor: bool,
    /// 线程中断是否开启。
    pub interrupt: bool,
}
```

可见, 我们需要保存所有的寄存器(x0-x31), sstatus 和 spec.
> [!note]为什么不需要保存stval和scause
> stval和scause在trap陷入之后便被使用且不会再用到, 因而不需要恢复. 而sstatus和spec在sret的时候还要用到, 为了防止被覆盖所以保存

## rCore Ch3 execute 汇编

在作业中, 其实并没有`__all_traps`和`__restore`两个函数, 而是利用了类似`__switch`换栈的思路进行了抽象, 变成了一个特殊的函数`execute()`, 调用execute会sret知道新的trap到来. 以及execute会保存之前的context并切换到下一个.

```rust
pub unsafe fn execute(&mut self) -> usize {
        {
            // 第一步：根据目标线程属性构造 sstatus（SPP/SPIE）。
            let mut sstatus = build_sstatus(self.supervisor, self.interrupt);
            // 保存 self 指针和 sepc，避免 release 模式下 csrrw 破坏寄存器后的问题
            let ctx_ptr = self as *mut Self;
            let mut sepc = self.sepc;
            let old_sscratch: usize;// 这行其实没有真的用到, sscratch只在切换的过程中有意义, 在前后没有(就像SPIE)

            // 第二步：切换到 execute_naked，执行真正的上下文保存/恢复。
            // SAFETY: 内联汇编执行上下文切换，调用者已确保处于 S 模式且 CSR 可被修改
            core::arch::asm!(
                "   csrrw {old_ss}, sscratch, {ctx} # 交换sscratch, 设置为ctx_ptr
                    csrw  sepc    , {sepc} # 设置spec
                    csrw  sstatus , {sstatus} # 设置sstatus
                    addi  sp, sp, -8 # 在栈上开空间用于保存ra
                    sd    ra, (sp) # ra压栈(call会改写ra)
                    call  {execute_naked}
                    ld    ra, (sp) # 弹出ra(ra of execute())
                    addi  sp, sp,  8 # 恢复sp
                    csrw  sscratch, {old_ss} # 输出就的sscratch
                    csrr  {sepc}   , sepc # 输出spec (在后续rust代码中保存)
                    csrr  {sstatus}, sstatus # 输出sstatus
                ",
                ctx           = in       (reg) ctx_ptr,
                old_ss        = out      (reg) old_sscratch,
                sepc          = inlateout(reg) sepc,
                sstatus       = inlateout(reg) sstatus,
                execute_naked = sym execute_naked,
            );
            let _ = old_sscratch; // suppress unused warning
            // 第三步：取回线程返回后的 sepc（比如 trap 后已更新到下一条指令）。
            (*ctx_ptr).sepc = sepc; // 保存spec
            sstatus
        }
    }


// execute的核心
#[unsafe(naked)]
unsafe extern "C" fn execute_naked() {
    core::arch::naked_asm!(
        r"  .altmacro
            .macro SAVE n
                sd x\n, \n*8(sp)
            .endm
            .macro SAVE_ALL
                sd x1, 1*8(sp)
                .set n, 3
                .rept 29
                    SAVE %n
                    .set n, n+1
                .endr
            .endm

            .macro LOAD n
                ld x\n, \n*8(sp)
            .endm
            .macro LOAD_ALL
                ld x1, 1*8(sp)
                .set n, 3
                .rept 29
                    LOAD %n
                    .set n, n+1
                .endr
            .endm
        ",// 以上是保存x0-x32的宏
        // 位置无关加载 禁用GOT
        "   .option push
            .option nopic
        ",
        // 保存调度上下文
        "   addi sp, sp, -32*8 # 保存在内核栈上
            SAVE_ALL
        ",
        // 设置陷入入口
        "   la   t0, 1f # 1f为后面的标签1
            csrw stvec, t0 # stvec是保存trap handler地址的csr
        ",
        // 保存调度上下文地址并切换上下文
        "   csrr t0, sscratch
            sd   sp, (t0) # sp到sctx成员()
            mv   sp, t0 # sp切换到新的ctx
        ",
        // 恢复线程上下文
        "   LOAD_ALL # LOAD execute目标的上下文
            ld   sp, 2*8(sp) # LOAD sp
        ",
        // 执行线程
        "   sret", // 正式返回U

        /* ===接下来是trap过程===*/

        // 陷入
        "   .align 2",
        // 切换上下文
        "1: csrrw sp, sscratch, sp", // 获取tra ctx ptr
        // 保存线程上下文
        "   SAVE_ALL
            csrrw t0, sscratch, sp # 获取旧的sp
            sd    t0, 2*8(sp)  #  保存旧的sp
        ",
        // 切换上下文
        "   ld sp, (sp)", // sp恢复为之前的sp
        // 恢复调度上下文
        "   LOAD_ALL
            addi sp, sp, 32*8
        ",
        // 返回调度
        "   ret", // 这回返回到execute()函数
        "   .option pop",
    )
}

```

有点复杂, 但是总体来说就是:

1. 构建target ctx: sscratch=ctx_ptr, spec设置, sstatus设置
2. ra压栈并call execute_naked
    1. 保存当前ctx到当前sp的栈上 并设置trap入口(stvec)
    2. sp与sscratch交换
    3. 根据当前sp(target_ctx) 恢复环境
    4. sret
        至此, 应用程序运行直到下一次trap
    5. 跳转到trap入口
    6. 当前sp与sscratch交换, 获取ctx_ptr
    7. 保存环境到ctx
    8. 根据ctx中的sctx找回之前保存的内核环境
    9. 恢复内存环境
    10. ret到execute
3. ra pop, 恢复execute的ra
4. execute获取ctx中制定信息并返回
