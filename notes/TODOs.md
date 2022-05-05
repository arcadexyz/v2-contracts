## TODOs

Evan:

- Installments PR

  - (DONE) Update `installmentWizard` to `currentInstallmentPeriod`.
  - (DONE) Update `getFullTermInterest` to `getFullInterestAmount`.
    - RepaymentController and LoanCore
  - (DONE) Update `calcInstallment` to `calcAmountsDue`.
  - (DONE) Change variable names from "interest" to "interestRate".
    - roots: `LoanTerms`, `LoanTermsWithItems` -> OriginationController, LoanCore, RepaymentController
  - (DONE) Add `getInstallmentMinPayment` view function to `repayPartMinimum` and `repayPart` functions to reduce repetitive code.
    - Changed this function to return the `loanId` attached to the borrowerNote. This saves both `repayPart` and `repayPartMinimum` from loading it as a local variable.
  - (DONE) Updated for loop so `minBalDue` was not double accounted for.
  - (DONE) Updated allowances in tests for late fee scenarios, all values here went down especially as the number of times compounded grew.
  - (DONE) Tests added for repaying minimum, waiting a while then repaying more.
  - (DONE) Removed all console logs from RepaymentController and LoanCore.

  - (IN PROGRESS)Tune LoanTerms dials for what will be accepted. Namely: `durationSeconds` and `numInstallments`.
    - Test the boundaries of these parameters.
  - (DONE) Add `closeLoan` function for borrower with automatically calculates the amount necessary to close the loan.
    - Corresponding view function.
    - tests
      - A scenario created here lead to finding the error with making a repayment in the same installment period
  - Implement `GRACE_PERIOD` into the repayment scheme.
    - tests

🔑 For Installment tests, run `npx hardhat test test/Installments.ts`.

📌 For Further Review Items:

- `createLoan` require statements that have been added
- Global parameters, `LATE_FEE` and `GRACE_PERIOD`
- `claim` functionality with installment loans

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
