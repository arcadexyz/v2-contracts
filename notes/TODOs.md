## TODOs

MAY 9 WHATS LEFT:

Safety/Robustness:
- Merge upgradeability
- Fix test suite and ensure 100% coverage or as close as possible

Refactoring:
- Split LoanCore into separate files (contract too big)
- Custom errors
- Make sure all files use 0.8.11 compiler
- Consistent documentation - move to implementation

Features:
- Installment Claim
- Signature expiry
- Move origination fee to fee controller
- Native rollovers


Evan:

- Installments PR
  - (DONE) Add `closeLoan` function for borrower with auto calculate the amount necessary to close the loan.
    - Corresponding view function.
    - Tests -> A scenario here lead to finding the error with making a repayment in the same installment period
  - (DONE) Add borrower and lenders balance before and after the loan in all tests to look for errors in the accounting code
  - (DONE) Add abstract contract for calculating the total interest amount based on a given principal and interest.
  - (DONE) Add args emitted from event to all installment tests where there is an event emitted.

🔑 For Installment tests, run `npx hardhat test test/Installments.ts`.

📌 For Further Review Items:
- Tune LoanTerms dials for what will be accepted. Namely: `durationSeconds` and `numInstallments`.
- Global parameters, `LATE_FEE` and `GRACE_PERIOD`
- `claim` functionality with installment loans, with grace period?
- Custom Errors

Mouzayan:

- Upgradeability and dependency architecture\
  ✅ &nbsp; Decide - which contracts should be upgradeable? What upgradebility pattern should they use?\
  ✅ &nbsp; Decide - which dependencies need to get passed in constructors for each contract?\
  ✅ &nbsp; Decide - of those dependencies, which should be changeable by an admin? Which should be immutable and / or only changeable by upgrade?\
  ✅ &nbsp; Outline the path to UUPS + ways to avoid storage clashes
- Outline changes to v2 Protocol to add upgradeability

✅ &nbsp; Future Scenarios List: What May Need to Change in the Future Scenarios\
✅ &nbsp; For each scenario, how would we make it possible? admin function or upgradeability etc...

✅ &nbsp; Look into [OZ upgrades plugin](https://docs.openzeppelin.com/upgrades-plugins/1.x/) for checks for conflicts, adds a deployment history you can check into git, wrapped "upgrade" functions for deploy scripts + other features\
✅ &nbsp; Compare with [Slither](https://github.com/crytic/slither/wiki/Upgradeability-Checks) plugin

✅ &nbsp; Review Origination PR

- Review Installments PR

Kevin:

- Write Origination tests
- Review installments PR

Leftover:

- Native rollovers
- Custom errors
- Move compiler to 0.8.11
- Re-do natspec - move to implementation, not interfaces
- Testing with full coverage
