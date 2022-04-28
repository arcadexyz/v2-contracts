## TODOs

Evan:

- Write installments tests
  - (DONE) Update LoanTerms struct.
    - Change from `collateralTokenId` to `collateralId`.
    - Move startDate variable to LoanData struct and fix tests
  - (DONE) Implement interest rate functionality into RepaymentController.sol.
    - legacy functions.
    - Internal calc function for interest rate for legacy functions.
    - Move over `repayPart` and `repayPartMinimum` functions
  - (DONE) Port over (5) RepaymentController functions and (1) LoanCore function.
    - Rewrite comments in natspec.
  - (DONE) Port over `repayPart` function to LoanCore.sol
    - Update other functions to jive with LoanTerms.
    - (NEEDS REVIEW) `createLoan` require statements added, need to review.
  - (DONE) port over two new test scripts into one script called `Installments.ts`.
    - Convert AssetWrapper in the tests to new AssetVault implementation.
  - (IN PROGRESS) Finish writing test scripts
    - tests around the createLoan require statements and interest as a rate with legacy functions.
    - for loop tests
  - (IN PROGRESS) Mark PR comments and fixes.
    - error handling, interest demonminator

- Other: Implement the `grantPeriod` into the RepaymentController.
  - tests

🔑 For Installment tests, run `npx hardhat test test/Installments.ts`.

📌 For Review Items:

- Minimum Payment and interest as a rate formulas.
- `createLoan` require statements added.
- Global parameters, `LATE_FEE` and `GRACE_PERIOD`.
- Interest rate changes for a percentage/ rate as opposed to total amount.
- `startDate` and `LoanData` in general being initialized in `createLoan` and not `startLoan`. What happens if `createLoan` is called separately or fails between create and start?

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
