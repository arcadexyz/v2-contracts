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
     - 📌 (NEEDS REVIEW) `createLoan` require statements added, need to review.
  - (DONE) port over two new test scripts into one script called `Installments.ts`.
    - Convert AssetWrapper in the tests to new AssetVault implementation.
  - (IN PROGRESS) Finish writing test scripts
    - tests around the createLoan require statements.

🔑 For Installment tests, run `npx hardhat test test/Installments.ts`.


Mouzayan:

- Upgradeability and dependency architecture
  - Decide - which contracts should be upgradeable? What upgradeability pattern should they use?
  - Decide - which dependencies need to get passed in constructors for each contract?
  - Decide - of those dependencies, which should be changeable by an admin? Which should be immutable and/or only changeable by upgrade?
- Review Installments PR and Origination PR

Kevin:

- Write Origination tests
- Review installments PR

Leftover:

- Native rollovers
- Custom errors
- Move compiler to 0.8.11
- Re-do natspec - move to implementation, not interfaces
- Testing with full coverage
